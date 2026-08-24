function canonicalContent(content) {
  if (content.includes(0)) return content;
  const text = content.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(content)) return content;
  return Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
}

module.exports = { canonicalContent };
