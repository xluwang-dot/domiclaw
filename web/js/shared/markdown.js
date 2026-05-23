// Shared Markdown + LaTeX renderer
// Used by app.html and admin.html

function renderContent(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const blocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push('<pre><code>' + code.trim() + '</code></pre>');
    return '%%C' + (blocks.length - 1) + '%%';
  });
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    blocks.push('<code>' + code + '</code>');
    return '%%C' + (blocks.length - 1) + '%%';
  });
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const safe = /^(https?:|data:image\/|\/)/i.test(src) ? src : '';
    return '<img src="' + safe + '" alt="' + alt + '" style="max-width:100%;height:auto;border-radius:4px;margin:4px 0">';
  });
  html = html.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => {
    try { return katex.renderToString(m.trim(), { displayMode: true, throwOnError: false }); } catch { return m; }
  });
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
    try { return katex.renderToString(m.trim(), { displayMode: true, throwOnError: false }); } catch { return m; }
  });
  html = html.replace(/\\\((.+?)\\\)/g, (_, m) => {
    try { return katex.renderToString(m.trim(), { displayMode: false, throwOnError: false }); } catch { return m; }
  });
  html = html.replace(/\$([^\$\n]+?)\$/g, (_, m) => {
    try { return katex.renderToString(m.trim(), { displayMode: false, throwOnError: false }); } catch { return m; }
  });
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  html = html.replace(/\n\n/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/%%C(\d+)%%/g, (_, i) => blocks[parseInt(i)] || '');
  return html;
}
