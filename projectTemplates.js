const PROJECT_TEMPLATES = Object.freeze({
  website: Object.freeze({
    id: 'website', label: 'Website', description: 'A responsive public-facing website with accessible pages and navigation.', port: '5173',
    requirements: 'Create a Vite-powered responsive website using semantic HTML, modern CSS, and JavaScript. Include accessible navigation, a polished home page, mobile layouts, and no server unless the description requires one.',
  }),
  app: Object.freeze({
    id: 'app', label: 'App', description: 'An interactive application with screens, reusable components, and saved data.', port: '5173',
    requirements: 'Create a Vite and React application with reusable components, clear empty/loading/error states, responsive screens, and local persistence unless another data store is requested.',
  }),
  api: Object.freeze({
    id: 'api', label: 'API', description: 'A documented backend service with validated endpoints and consistent errors.', port: '3000',
    requirements: 'Create a Node.js Express JSON API with input validation, consistent error responses, health endpoint, environment configuration, example requests, and automated endpoint tests.',
  }),
});

function getProjectTemplate(id) { return PROJECT_TEMPLATES[id] || null; }

module.exports = { PROJECT_TEMPLATES, getProjectTemplate };
