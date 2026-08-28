// Nexus App Check broker page.
//
// This page is loaded only inside a hidden, sandboxed Electron BrowserWindow
// (see appCheckBroker.js) on the exact Firebase Hosting origin that the
// reCAPTCHA Enterprise site key is restricted to. It never renders anything
// visible and is never loaded in the app's normal UI.
//
// Flow: load the reCAPTCHA Enterprise script -> get a reCAPTCHA token ->
// exchange it for a Firebase App Check token via the App Check REST API ->
// report the token back to the Electron main process through the narrow
// bridge exposed by appCheckBrokerPreload.js. The token never touches
// localStorage, cookies, the URL, or console output.

(function () {
  'use strict';

  var bridge = window.nexusAppCheckBridge;
  if (!bridge) return;

  function fail(message) {
    try { bridge.reportError(String(message || 'App Check broker failed.')); } catch (_err) { /* nothing left to report to */ }
  }

  function parseAppCheckTtlMs(ttl) {
    var match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(String(ttl || ''));
    var seconds = match ? Number(match[1]) : 3600;
    return Math.max(60, Math.floor(seconds)) * 1000;
  }

  function exchangeToken(config, recaptchaToken) {
    var url = 'https://content-firebaseappcheck.googleapis.com/v1/projects/' +
      encodeURIComponent(config.firebaseProjectNumber) + '/apps/' +
      encodeURIComponent(config.firebaseWebAppId) + ':exchangeRecaptchaEnterpriseToken?key=' +
      encodeURIComponent(config.firebaseWebApiKey);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recaptchaEnterpriseToken: recaptchaToken }),
    })
      .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data || !result.data.token) {
          fail('App Check token exchange failed: ' + (result.data && result.data.error && result.data.error.message));
          return;
        }
        bridge.reportToken(result.data.token, Date.now() + parseAppCheckTtlMs(result.data.ttl));
      })
      .catch(function (error) { fail('App Check token exchange request failed: ' + (error && error.message)); });
  }

  function loadRecaptchaAndExecute(config) {
    var script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/enterprise.js?render=' + encodeURIComponent(config.recaptchaEnterpriseSiteKey);
    script.onerror = function () { fail('Could not load the reCAPTCHA Enterprise script.'); };
    script.onload = function () {
      try {
        window.grecaptcha.enterprise.ready(function () {
          window.grecaptcha.enterprise
            .execute(config.recaptchaEnterpriseSiteKey, { action: 'app_check' })
            .then(function (recaptchaToken) { exchangeToken(config, recaptchaToken); })
            .catch(function (error) { fail('reCAPTCHA execute failed: ' + (error && error.message)); });
        });
      } catch (error) { fail('reCAPTCHA ready failed: ' + (error && error.message)); }
    };
    document.head.appendChild(script);
  }

  fetch('./config.json', { cache: 'no-store' })
    .then(function (response) { if (!response.ok) throw new Error('Broker config.json is missing. Deploy it alongside this page.'); return response.json(); })
    .then(function (config) {
      var siteKey = String(config.recaptchaEnterpriseSiteKey || '');
      var apiKey = String(config.firebaseWebApiKey || '');
      var projectNumber = String(config.firebaseProjectNumber || '');
      var appId = String(config.firebaseWebAppId || '');
      if (!siteKey || !apiKey || !projectNumber || !appId) throw new Error('Broker config.json is missing required fields.');
      loadRecaptchaAndExecute({ recaptchaEnterpriseSiteKey: siteKey, firebaseWebApiKey: apiKey, firebaseProjectNumber: projectNumber, firebaseWebAppId: appId });
    })
    .catch(function (error) { fail(error && error.message); });
})();
