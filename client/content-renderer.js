(function () {
  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function parseBlock(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (error) {
      return { text: String(raw || "") };
    }

    return { text: String(raw || "") };
  }

  function getYouTubeEmbedUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtube.com")) {
        const videoId = parsed.searchParams.get("v");
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      }

      if (parsed.hostname.includes("youtu.be")) {
        const videoId = parsed.pathname.replace("/", "");
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      }
    } catch (error) {
      return "";
    }

    return "";
  }

  function dimensionStyle(data, defaults = {}) {
    const widthValue = String(data.widthValue || defaults.widthValue || "").trim();
    const widthUnit = data.widthUnit === "%" ? "%" : "px";
    const heightValue = String(data.heightValue || defaults.heightValue || "").trim();
    const heightUnit = data.heightUnit === "%" ? "%" : "px";
    const styles = [];

    if (widthValue) styles.push(`width:${widthValue}${widthUnit}`);
    if (heightValue) styles.push(`height:${heightValue}${heightUnit}`);
    if (!heightValue) styles.push("height:auto");

    styles.push("max-width:100%");
    return styles.join(";");
  }

  function resizeFrame(frame) {
    if (!frame) return;

    try {
      const documentElement = frame.contentDocument?.documentElement;
      const body = frame.contentDocument?.body;
      const height = Math.max(
        documentElement?.scrollHeight || 0,
        body?.scrollHeight || 0,
        320
      );

      frame.style.height = `${height + 12}px`;
    } catch (error) {
      // Якщо браузер заборонив доступ до iframe, лишаємо мінімальну висоту.
    }
  }

  function resizeHtmlFrames(root) {
    const container = root || document;
    container.querySelectorAll(".content-html-frame").forEach(frame => {
      resizeFrame(frame);
      setTimeout(() => resizeFrame(frame), 100);
      setTimeout(() => resizeFrame(frame), 500);
      setTimeout(() => resizeFrame(frame), 1500);
    });
  }

  function renderHtmlBlock(data) {
    const html = data.html || "";
    const css = data.css || "";
    const js = data.js || "";

    const srcdoc = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
            ${css}
          </style>
        </head>
        <body>
          ${html}
          <script>
            try {
              ${js}
            } catch (error) {
              document.body.insertAdjacentHTML('beforeend', '<pre style="color:#b91c1c;white-space:pre-wrap;">JS error: ' + String(error.message || error) + '</pre>');
            }
          <\/script>
        </body>
      </html>
    `;

    return `
      <iframe
        class="content-html-frame"
        sandbox="allow-scripts allow-same-origin"
        srcdoc="${escapeHtml(srcdoc)}"
        loading="lazy"
        onload="window.QEContentRenderer && window.QEContentRenderer.resizeFrame(this)"
      ></iframe>
    `;
  }

  function renderBlock(block) {
    const type = String(block.type || "TEXT").toUpperCase();
    const data = parseBlock(block.content || block.data || block);

    if (type === "TEXT") {
      const html = data.html || "";
      const legacyText = escapeHtml(data.text || "").replaceAll("\n", "<br>");

      return `
        <div class="content-block content-text-block tiptap-rendered-content">
          ${html || legacyText}
        </div>
      `;
    }

    if (type === "IMAGE") {
      const src = data.url || "";
      if (!src) return "";
      const style = dimensionStyle(data, { widthValue: "600" });

      return `
        <figure class="content-block content-image-block">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(data.alt || "")}" style="${escapeHtml(style)}">
          ${data.caption ? `<figcaption>${escapeHtml(data.caption)}</figcaption>` : ""}
        </figure>
      `;
    }

    if (type === "VIDEO") {
      const url = data.url || "";
      if (!url) return "";
      const containerStyle = dimensionStyle(data, { widthValue: "720" });
      const youtubeEmbed = getYouTubeEmbedUrl(url);

      if (youtubeEmbed) {
        return `
          <div class="content-block content-video-block" style="${escapeHtml(containerStyle)}">
            <iframe
              src="${escapeHtml(youtubeEmbed)}"
              title="Відео"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
            ></iframe>
          </div>
        `;
      }

      return `
        <div class="content-block content-video-block" style="${escapeHtml(containerStyle)}">
          <video controls src="${escapeHtml(url)}"></video>
        </div>
      `;
    }

    if (type === "AUDIO") {
      const url = data.url || "";
      if (!url) return "";

      return `
        <div class="content-block content-audio-block">
          <audio controls src="${escapeHtml(url)}"></audio>
        </div>
      `;
    }

    if (type === "HTML") {
      return `
        <div class="content-block content-custom-html-block">
          ${renderHtmlBlock(data)}
        </div>
      `;
    }

    if (type === "SECTION") {
      const columns = Array.isArray(data.columns) ? data.columns : [];
      if (!columns.length) return "";

      return `
        <section class="content-block content-section-block">
          ${columns.map(column => `
            <div class="content-section-column" style="flex-basis:${Number(column.width) || 1}%;">
              ${renderBlocks(column.blocks || [])}
            </div>
          `).join("")}
        </section>
      `;
    }

    return "";
  }

  function renderBlocks(blocks) {
    if (!Array.isArray(blocks)) return "";
    return blocks.map(renderBlock).join("");
  }

  window.QEContentRenderer = {
    parseBlock,
    renderBlock,
    renderBlocks,
    resizeFrame,
    resizeHtmlFrames
  };
})();
