(function () {
  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function parseData(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "object") return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (error) {
      return { text: String(value || "") };
    }
  }

  function defaultData(type) {
    if (type === "TEXT") return { text: "" };
    if (type === "IMAGE") return { source: "URL", url: "", alt: "", caption: "" };
    if (type === "VIDEO") return { url: "" };
    if (type === "AUDIO") return { source: "URL", url: "" };
    if (type === "HTML") return { html: "", css: "", js: "", isolated: true };
    return {};
  }

  function labelForType(type) {
    const labels = {
      TEXT: "Текст",
      IMAGE: "Зображення",
      VIDEO: "Відео",
      AUDIO: "Аудіо",
      HTML: "HTML/CSS/JS"
    };

    return labels[type] || type;
  }

  function normalizeBlock(block) {
    const type = String(block.type || "TEXT").toUpperCase();
    return {
      id: block.id || `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      data: parseData(block.data || block.content, defaultData(type))
    };
  }

  class ContentBuilder {
    constructor(options) {
      this.root = options.root;
      this.previewButton = options.previewButton || null;
      this.blocks = (options.blocks || []).map(normalizeBlock);
      this.onChange = options.onChange || function () {};
      this.previewTitle = options.previewTitle || "Попередній перегляд";
      this.render();
    }

    setBlocks(blocks) {
      this.blocks = (blocks || []).map(normalizeBlock);
      this.render();
    }

    getBlocks() {
      this.syncFromDom();
      return this.blocks.map(block => ({
        type: block.type,
        content: JSON.stringify(block.data || defaultData(block.type))
      }));
    }

    getPreviewBlocks() {
      this.syncFromDom();
      return this.blocks.map(block => ({
        type: block.type,
        content: block.data
      }));
    }

    addBlock(type) {
      this.syncFromDom();
      this.blocks.push({
        id: `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type,
        data: defaultData(type)
      });
      this.render();
      this.onChange();
    }

    moveBlock(index, direction) {
      this.syncFromDom();
      const target = index + direction;
      if (target < 0 || target >= this.blocks.length) return;
      const [block] = this.blocks.splice(index, 1);
      this.blocks.splice(target, 0, block);
      this.render();
      this.onChange();
    }

    deleteBlock(index) {
      if (!confirm("Видалити цей блок?")) return;
      this.syncFromDom();
      this.blocks.splice(index, 1);
      this.render();
      this.onChange();
    }

    syncFromDom() {
      if (!this.root) return;

      this.blocks.forEach((block, index) => {
        const wrapper = this.root.querySelector(`[data-builder-index="${index}"]`);
        if (!wrapper) return;

        if (block.type === "TEXT") {
          block.data.text = wrapper.querySelector(`[data-field="text"]`)?.value || "";
        }

        if (block.type === "IMAGE") {
          block.data.source = wrapper.querySelector(`[data-field="source"]`)?.value || "URL";
          block.data.url = wrapper.querySelector(`[data-field="url"]`)?.value || "";
          block.data.alt = wrapper.querySelector(`[data-field="alt"]`)?.value || "";
          block.data.caption = wrapper.querySelector(`[data-field="caption"]`)?.value || "";
        }

        if (block.type === "VIDEO") {
          block.data.url = wrapper.querySelector(`[data-field="url"]`)?.value || "";
        }

        if (block.type === "AUDIO") {
          block.data.source = wrapper.querySelector(`[data-field="source"]`)?.value || "URL";
          block.data.url = wrapper.querySelector(`[data-field="url"]`)?.value || "";
        }

        if (block.type === "HTML") {
          block.data.html = wrapper.querySelector(`[data-field="html"]`)?.value || "";
          block.data.css = wrapper.querySelector(`[data-field="css"]`)?.value || "";
          block.data.js = wrapper.querySelector(`[data-field="js"]`)?.value || "";
          block.data.isolated = wrapper.querySelector(`[data-field="isolated"]`)?.checked !== false;
        }
      });
    }

    render() {
      if (!this.root) return;

      this.root.innerHTML = `
        <div class="builder-toolbar">
          <button type="button" data-action="add" data-type="TEXT">+ Текст</button>
          <button type="button" data-action="add" data-type="IMAGE">+ Зображення</button>
          <button type="button" data-action="add" data-type="VIDEO">+ Відео</button>
          <button type="button" data-action="add" data-type="AUDIO">+ Аудіо</button>
          <button type="button" data-action="add" data-type="HTML">+ HTML/CSS/JS</button>
        </div>

        <div class="builder-blocks">
          ${this.blocks.length ? this.blocks.map((block, index) => this.renderBlock(block, index)).join("") : `
            <div class="builder-empty">Контенту поки немає. Додайте перший блок.</div>
          `}
        </div>
      `;

      this.root.querySelectorAll("[data-action]").forEach(button => {
        button.addEventListener("click", async () => {
          const action = button.dataset.action;
          const index = Number(button.dataset.index);

          if (action === "add") this.addBlock(button.dataset.type);
          if (action === "up") this.moveBlock(index, -1);
          if (action === "down") this.moveBlock(index, 1);
          if (action === "delete") this.deleteBlock(index);
          if (action === "upload-image") await this.uploadImage(index);
          if (action === "upload-audio") await this.uploadAudio(index);
        });
      });

      this.root.querySelectorAll("input, textarea, select").forEach(input => {
        input.addEventListener("input", () => this.onChange());
        input.addEventListener("change", () => this.onChange());
      });
    }

    renderBlock(block, index) {
      return `
        <div class="builder-block" data-builder-index="${index}">
          <div class="builder-block-header">
            <strong>${index + 1}. ${labelForType(block.type)}</strong>
            <div class="builder-block-actions">
              <button type="button" data-action="up" data-index="${index}" ${index === 0 ? "disabled" : ""}>↑</button>
              <button type="button" data-action="down" data-index="${index}" ${index === this.blocks.length - 1 ? "disabled" : ""}>↓</button>
              <button type="button" data-action="delete" data-index="${index}" class="danger-btn">Видалити</button>
            </div>
          </div>
          <div class="builder-block-body">
            ${this.renderEditor(block, index)}
          </div>
        </div>
      `;
    }

    renderEditor(block, index) {
      const data = block.data || defaultData(block.type);

      if (block.type === "TEXT") {
        return `
          <label>Текст</label>
          <textarea data-field="text" rows="7" placeholder="Текст, який побачать гравці">${escapeHtml(data.text || "")}</textarea>
        `;
      }

      if (block.type === "IMAGE") {
        return `
          <label>Спосіб додавання</label>
          <select data-field="source">
            <option value="URL" ${data.source !== "UPLOAD" ? "selected" : ""}>URL</option>
            <option value="UPLOAD" ${data.source === "UPLOAD" ? "selected" : ""}>Завантажити файл</option>
          </select>

          <label>URL зображення</label>
          <input data-field="url" type="text" value="${escapeHtml(data.url || "")}" placeholder="https://... або /uploads/...">

          <div class="builder-upload-row">
            <input data-field="file" type="file" accept="image/*">
            <button type="button" data-action="upload-image" data-index="${index}">Завантажити</button>
          </div>

          <label>Alt-текст</label>
          <input data-field="alt" type="text" value="${escapeHtml(data.alt || "")}" placeholder="Короткий опис зображення">

          <label>Підпис під зображенням</label>
          <input data-field="caption" type="text" value="${escapeHtml(data.caption || "")}" placeholder="Необовʼязково">

          ${data.url ? `<div class="builder-preview"><img src="${escapeHtml(data.url)}" alt=""></div>` : ""}
        `;
      }

      if (block.type === "VIDEO") {
        return `
          <label>URL відео</label>
          <input data-field="url" type="text" value="${escapeHtml(data.url || "")}" placeholder="YouTube, Vimeo або пряме посилання на mp4/webm">
        `;
      }

      if (block.type === "AUDIO") {
        return `
          <label>Спосіб додавання</label>
          <select data-field="source">
            <option value="URL" ${data.source !== "UPLOAD" ? "selected" : ""}>URL</option>
            <option value="UPLOAD" ${data.source === "UPLOAD" ? "selected" : ""}>Завантажити файл</option>
          </select>

          <label>URL аудіо</label>
          <input data-field="url" type="text" value="${escapeHtml(data.url || "")}" placeholder="https://.../audio.mp3 або /uploads/audio.mp3">

          <div class="builder-upload-row">
            <input data-field="audioFile" type="file" accept="audio/*">
            <button type="button" data-action="upload-audio" data-index="${index}">Завантажити аудіо</button>
          </div>

          ${data.url ? `<div class="builder-audio-preview"><audio controls src="${escapeHtml(data.url)}"></audio></div>` : ""}
        `;
      }

      if (block.type === "HTML") {
        return `
          <label>HTML</label>
          <textarea data-field="html" rows="7" spellcheck="false" placeholder="<div>...</div>">${escapeHtml(data.html || "")}</textarea>

          <label>CSS</label>
          <textarea data-field="css" rows="6" spellcheck="false" placeholder=".my-class { ... }">${escapeHtml(data.css || "")}</textarea>

          <label>JavaScript</label>
          <textarea data-field="js" rows="6" spellcheck="false" placeholder="console.log('hello')">${escapeHtml(data.js || "")}</textarea>

          <label class="inline-checkbox">
            <input data-field="isolated" type="checkbox" ${data.isolated !== false ? "checked" : ""}>
            Ізолювати блок в iframe
          </label>
        `;
      }

      return "";
    }

    async uploadImage(index) {
      this.syncFromDom();
      const wrapper = this.root.querySelector(`[data-builder-index="${index}"]`);
      const input = wrapper?.querySelector(`[data-field="file"]`);
      const file = input?.files?.[0];

      if (!file) {
        alert("Оберіть файл зображення");
        return;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch("/api/uploads/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          dataUrl
        })
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.error || "Помилка завантаження зображення");
        return;
      }

      this.blocks[index].data.source = "UPLOAD";
      this.blocks[index].data.url = result.url;
      this.render();
      this.onChange();
    }

    async uploadAudio(index) {
      this.syncFromDom();
      const wrapper = this.root.querySelector(`[data-builder-index="${index}"]`);
      const input = wrapper?.querySelector(`[data-field="audioFile"]`);
      const file = input?.files?.[0];

      if (!file) {
        alert("Оберіть аудіофайл");
        return;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch("/api/uploads/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          dataUrl
        })
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.error || "Помилка завантаження аудіо");
        return;
      }

      this.blocks[index].data.source = "UPLOAD";
      this.blocks[index].data.url = result.url;
      this.render();
      this.onChange();
    }

    openPreview(title) {
      const payload = {
        title: title || this.previewTitle,
        blocks: this.getPreviewBlocks()
      };

      sessionStorage.setItem("qePreviewPayload", JSON.stringify(payload));
      window.open("/page-preview.html", "_blank");
    }
  }

  window.QEContentBuilder = ContentBuilder;
})();
