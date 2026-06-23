(function () {
  const TIPTAP_CDN_BASE = "https://esm.sh";

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function parseData(value, fallback = {}) {
    if (!value) return structuredCloneSafe(fallback);
    if (typeof value === "object") return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : structuredCloneSafe(fallback);
    } catch (error) {
      return { text: String(value || "") };
    }
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function textToHtml(text) {
    const escaped = escapeHtml(text || "");
    if (!escaped.trim()) return "<p></p>";

    return escaped
      .split(/\n{2,}/)
      .map(paragraph => `<p>${paragraph.replaceAll("\n", "<br>")}</p>`)
      .join("");
  }

  function mediaDefaults(type) {
    if (type === "IMAGE") {
      return {
        source: "URL",
        url: "",
        alt: "",
        caption: "",
        widthValue: "600",
        widthUnit: "px",
        heightValue: "",
        heightUnit: "px"
      };
    }

    if (type === "VIDEO") {
      return {
        source: "URL",
        url: "",
        widthValue: "720",
        widthUnit: "px",
        heightValue: "",
        heightUnit: "px"
      };
    }

    return {};
  }

  function defaultData(type) {
    if (type === "TEXT") return { text: "", html: "<p></p>", json: null, format: "tiptap" };
    if (type === "IMAGE") return mediaDefaults("IMAGE");
    if (type === "VIDEO") return mediaDefaults("VIDEO");
    if (type === "AUDIO") return { source: "URL", url: "" };
    if (type === "HTML") return { html: "", css: "", js: "", isolated: true };
    if (type === "SECTION") return {
      columns: [
        { width: 100, blocks: [] }
      ]
    };
    return {};
  }

  function ensureMediaDimensions(data, type) {
    const defaults = mediaDefaults(type);
    return {
      ...defaults,
      ...(data || {})
    };
  }

  function normalizeDimensionValue(value) {
    const cleaned = String(value || "").trim().replace(",", ".");
    if (!cleaned) return "";
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed <= 0) return "";
    return String(parsed);
  }

  function normalizeUnit(value) {
    return value === "%" ? "%" : "px";
  }

  function labelForType(type) {
    const labels = {
      TEXT: "Текст / WYSIWYG",
      IMAGE: "Зображення",
      VIDEO: "Відео",
      AUDIO: "Аудіо",
      HTML: "HTML/CSS/JS",
      SECTION: "Секція / колонки"
    };

    return labels[type] || type;
  }

  function makeBlock(type) {
    return {
      id: `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      data: defaultData(type)
    };
  }

  function normalizeBlock(block) {
    const type = String(block.type || "TEXT").toUpperCase();
    const data = parseData(block.data || block.content, defaultData(type));

    if (type === "TEXT") {
      if (!data.html && data.text) {
        data.html = textToHtml(data.text);
      }
      if (!data.format) {
        data.format = data.html ? "tiptap" : "plain";
      }
    }

    if (type === "IMAGE" || type === "VIDEO") {
      Object.assign(data, ensureMediaDimensions(data, type));
    }

    if (type === "SECTION") {
      const columns = Array.isArray(data.columns) && data.columns.length ? data.columns : defaultData("SECTION").columns;
      data.columns = columns.map(column => ({
        width: Number(column.width) || 50,
        blocks: Array.isArray(column.blocks) ? column.blocks.map(normalizeBlock) : []
      }));
    }

    return {
      id: block.id || `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      data
    };
  }

  let tiptapModulesPromise = null;

  async function loadTiptapModules() {
    if (window.QETiptapModules) {
      return window.QETiptapModules;
    }

    if (!tiptapModulesPromise) {
      tiptapModulesPromise = Promise.all([
        import(`${TIPTAP_CDN_BASE}/@tiptap/core@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/starter-kit@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-underline@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-text-align@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-text-style@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-color@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-link@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-table@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-table-row@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-table-header@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-table-cell@2.11.7`),
        import(`${TIPTAP_CDN_BASE}/@tiptap/extension-image@2.11.7`)
      ]).then(([
        core,
        starterKit,
        underline,
        textAlign,
        textStyle,
        color,
        link,
        table,
        tableRow,
        tableHeader,
        tableCell,
        image
      ]) => {
        const modules = {
          Editor: core.Editor,
          Extension: core.Extension,
          StarterKit: starterKit.default,
          Underline: underline.default,
          TextAlign: textAlign.default,
          TextStyle: textStyle.default,
          Color: color.default,
          Link: link.default,
          Table: table.default,
          TableRow: tableRow.default,
          TableHeader: tableHeader.default,
          TableCell: tableCell.default,
          Image: image.default
        };

        window.QETiptapModules = modules;
        return modules;
      });
    }

    return tiptapModulesPromise;
  }

  class ContentBuilder {
    constructor(options) {
      this.root = options.root;
      this.previewButton = options.previewButton || null;
      this.blocks = (options.blocks || []).map(normalizeBlock);
      this.onChange = options.onChange || function () {};
      this.previewTitle = options.previewTitle || "Попередній перегляд";
      this.textEditors = new Map();
      this.render();
    }

    setBlocks(blocks) {
      this.destroyTextEditors();
      this.blocks = (blocks || []).map(normalizeBlock);
      this.render();
    }

    destroyTextEditors() {
      this.textEditors.forEach(editor => {
        try {
          editor.destroy();
        } catch (error) {}
      });
      this.textEditors.clear();
    }

    serializeBlock(block, preview = false) {
      if (block.type === "SECTION") {
        const data = {
          columns: (block.data.columns || []).map(column => ({
            width: Number(column.width) || 0,
            blocks: (column.blocks || []).map(child => this.serializeBlock(child, preview))
          }))
        };

        return {
          type: block.type,
          content: preview ? data : JSON.stringify(data)
        };
      }

      return {
        type: block.type,
        content: preview ? block.data : JSON.stringify(block.data || defaultData(block.type))
      };
    }

    getBlocks() {
      this.syncFromDom();
      const invalidSections = this.validateSections();
      if (invalidSections.length) {
        throw new Error("У секціях сума ширин колонок має дорівнювати 100%.");
      }
      return this.blocks.map(block => this.serializeBlock(block, false));
    }

    getPreviewBlocks() {
      this.syncFromDom();
      return this.blocks.map(block => this.serializeBlock(block, true));
    }

    getBlockList(containerPath = "") {
      if (!containerPath) return this.blocks;

      const parts = this.parsePath(containerPath);
      if (parts.length !== 2) return this.blocks;

      const section = this.blocks[parts[0]];
      if (!section || section.type !== "SECTION") return this.blocks;

      return section.data.columns?.[parts[1]]?.blocks || [];
    }

    getBlockByPath(path) {
      const parts = this.parsePath(path);
      if (parts.length === 1) return this.blocks[parts[0]] || null;
      if (parts.length === 3) {
        return this.blocks[parts[0]]?.data?.columns?.[parts[1]]?.blocks?.[parts[2]] || null;
      }
      return null;
    }

    getBlockListForBlockPath(path) {
      const parts = this.parsePath(path);
      if (parts.length === 1) return this.blocks;
      if (parts.length === 3) return this.blocks[parts[0]]?.data?.columns?.[parts[1]]?.blocks || [];
      return this.blocks;
    }

    parsePath(path) {
      return String(path || "")
        .split(":")
        .filter(Boolean)
        .map(part => Number(part));
    }

    addBlock(type, containerPath = "") {
      this.syncFromDom();

      // На верхньому рівні сторінки дозволяємо створювати тільки секції.
      // Весь контент додається вже всередину колонок секції.
      const normalizedType = String(type || "").toUpperCase();
      if (!containerPath && normalizedType !== "SECTION") {
        return;
      }

      const list = this.getBlockList(containerPath);
      list.push(makeBlock(normalizedType));
      const newIndex = list.length - 1;
      const newPath = containerPath ? `${containerPath}:${newIndex}` : String(newIndex);
      this.render();
      if (["IMAGE", "VIDEO", "AUDIO"].includes(normalizedType)) {
        this.openMediaModal(newPath);
      }
      this.onChange();
    }

    moveBlock(path, direction) {
      this.syncFromDom();
      const parts = this.parsePath(path);
      const index = parts[parts.length - 1];
      const list = this.getBlockListForBlockPath(path);
      const target = index + direction;
      if (target < 0 || target >= list.length) return;
      const [block] = list.splice(index, 1);
      list.splice(target, 0, block);
      this.render();
      this.onChange();
    }

    deleteBlock(path) {
      if (!confirm("Видалити цей блок?")) return;
      this.syncFromDom();
      const parts = this.parsePath(path);
      const index = parts[parts.length - 1];
      const list = this.getBlockListForBlockPath(path);
      list.splice(index, 1);
      this.render();
      this.onChange();
    }

    updateSectionColumns(path) {
      this.syncFromDom();
      const section = this.getBlockByPath(path);
      if (!section || section.type !== "SECTION") return;

      const input = this.root.querySelector(`[data-section-column-count="${path}"]`);
      const count = Math.max(1, Math.min(4, Number(input?.value) || 1));
      const current = Array.isArray(section.data.columns) ? section.data.columns : [];
      const equalWidth = Math.floor(100 / count);
      const remainder = 100 - equalWidth * count;

      const nextColumns = [];
      for (let i = 0; i < count; i += 1) {
        nextColumns.push({
          width: current[i]?.width || equalWidth + (i === count - 1 ? remainder : 0),
          blocks: current[i]?.blocks || []
        });
      }

      section.data.columns = nextColumns;
      this.render();
      this.onChange();
    }

    validateSections() {
      const invalid = [];

      const check = (blocks, prefix = "") => {
        blocks.forEach((block, index) => {
          const path = prefix ? `${prefix}:${index}` : String(index);
          if (block.type === "SECTION") {
            const columns = block.data.columns || [];
            const sum = columns.reduce((acc, column) => acc + (Number(column.width) || 0), 0);
            if (columns.some(column => (Number(column.width) || 0) <= 0) || sum !== 100) {
              invalid.push(path);
            }
            columns.forEach((column, columnIndex) => check(column.blocks || [], `${path}:${columnIndex}`));
          }
        });
      };

      check(this.blocks);
      return invalid;
    }

    syncFromDom() {
      if (!this.root) return;

      const syncBlock = (block, path) => {
        const wrapper = this.root.querySelector(`[data-builder-path="${path}"]`);
        if (!wrapper) return;

        if (block.type === "TEXT") {
          const editor = this.textEditors.get(block.id);
          const fallback = wrapper.querySelector(`[data-field="text-html"]`);

          if (editor) {
            block.data.html = editor.getHTML();
            block.data.json = editor.getJSON();
            block.data.text = editor.getText();
            block.data.format = "tiptap";
          } else if (fallback) {
            block.data.html = fallback.innerHTML || "<p></p>";
            block.data.text = fallback.textContent || "";
            block.data.format = "html";
          }
        }

        if (["IMAGE", "VIDEO", "AUDIO"].includes(block.type)) {
          // Media blocks are edited only through the pop-up modal.
          // Nothing should be synced from the visible preview.
        }

        if (block.type === "HTML") {
          block.data.html = wrapper.querySelector(`[data-field="html"]`)?.value || "";
          block.data.css = wrapper.querySelector(`[data-field="css"]`)?.value || "";
          block.data.js = wrapper.querySelector(`[data-field="js"]`)?.value || "";
          block.data.isolated = wrapper.querySelector(`[data-field="isolated"]`)?.checked !== false;
        }

        if (block.type === "SECTION") {
          (block.data.columns || []).forEach((column, columnIndex) => {
            const widthInput = this.root.querySelector(`[data-section-width="${path}:${columnIndex}"]`);
            column.width = Math.max(1, Math.min(100, Number(widthInput?.value) || column.width || 1));
            (column.blocks || []).forEach((child, childIndex) => {
              syncBlock(child, `${path}:${columnIndex}:${childIndex}`);
            });
          });
        }
      };

      this.blocks.forEach((block, index) => syncBlock(block, String(index)));
    }

    render() {
      if (!this.root) return;

      this.destroyTextEditors();

      this.root.innerHTML = `
        <div class="builder-content-tab-title">Контент</div>

        <div class="builder-blocks">
          ${this.blocks.length ? this.blocks.map((block, index) => this.renderBlock(block, String(index), this.blocks.length)).join("") : `
            <div class="builder-empty">Тут ще немає жодного контенту.</div>
          `}
        </div>

        <div class="builder-toolbar builder-add-section-toolbar">
          <button type="button" data-action="add" data-type="SECTION">+ Додати секцію</button>
        </div>
      `;

      this.root.querySelectorAll("[data-action]").forEach(button => {
        button.addEventListener("click", async () => {
          const action = button.dataset.action;
          const path = button.dataset.path || "";
          const index = Number(this.parsePath(path).slice(-1)[0]);

          if (action === "add") this.addBlock(button.dataset.type, button.dataset.containerPath || "");
          if (action === "up") this.moveBlock(path, -1);
          if (action === "down") this.moveBlock(path, 1);
          if (action === "delete") this.deleteBlock(path);
          if (action === "edit-media") this.openMediaModal(path);
          if (action === "upload-image") await this.uploadImage(path);
          if (action === "upload-audio") await this.uploadAudio(path);
          if (action === "update-section-columns") this.updateSectionColumns(path);
        });
      });

      this.root.querySelectorAll("[data-media-preview-path]").forEach(preview => {
        preview.addEventListener("dblclick", () => this.openMediaModal(preview.dataset.mediaPreviewPath));
        preview.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.openMediaModal(preview.dataset.mediaPreviewPath);
          }
        });
      });

      this.root.querySelectorAll("[data-editor-action]").forEach(control => {
        control.addEventListener("click", event => this.handleTextEditorAction(event));
        control.addEventListener("change", event => this.handleTextEditorAction(event));
      });

      this.root.querySelectorAll("input, textarea, select").forEach(input => {
        input.addEventListener("input", () => this.onChange());
        input.addEventListener("change", () => this.onChange());
      });

      this.initTextEditors();
    }

    renderBlock(block, path, siblingCount) {
      const parts = this.parsePath(path);
      const index = parts[parts.length - 1];
      return `
        <div class="builder-block ${block.type === "SECTION" ? "builder-section-block" : ""}" data-builder-path="${path}" data-block-id="${escapeHtml(block.id)}">
          <div class="builder-block-header">
            <strong>${index + 1}. ${labelForType(block.type)}</strong>
            <div class="builder-block-actions">
              <button type="button" data-action="up" data-path="${path}" ${index === 0 ? "disabled" : ""}>↑</button>
              <button type="button" data-action="down" data-path="${path}" ${index === siblingCount - 1 ? "disabled" : ""}>↓</button>
              <button type="button" data-action="delete" data-path="${path}" class="danger-btn">Видалити</button>
            </div>
          </div>
          <div class="builder-block-body">
            ${this.renderEditor(block, path)}
          </div>
        </div>
      `;
    }

    renderTextEditor(block, path) {
      const data = block.data || defaultData(block.type);
      const safeHtml = data.html || textToHtml(data.text || "");

      return `
        <div class="tiptap-block" data-text-editor-path="${path}">
          <div class="tiptap-toolbar compact-tiptap-toolbar">
            <div class="tiptap-toolbar-group tiptap-toolbar-text-group">
              <select class="tiptap-font-family-select" title="Шрифт" aria-label="Шрифт" data-editor-action="fontFamily" data-path="${path}">
                <option value="">Шрифт</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Verdana, sans-serif">Verdana</option>
                <option value="Tahoma, sans-serif">Tahoma</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="Times New Roman, serif">Times New Roman</option>
                <option value="Courier New, monospace">Courier New</option>
              </select>
              <select class="tiptap-font-size-select" title="Розмір тексту" aria-label="Розмір тексту" data-editor-action="fontSize" data-path="${path}">
                <option value="">Розмір</option>
                <option value="10px">10</option>
                <option value="12px">12</option>
                <option value="14px">14</option>
                <option value="16px">16</option>
                <option value="18px">18</option>
                <option value="20px">20</option>
                <option value="24px">24</option>
                <option value="28px">28</option>
                <option value="32px">32</option>
                <option value="48px">48</option>
                <option value="72px">72</option>
              </select>
              <label class="tiptap-color-label compact-color-control" title="Колір тексту" aria-label="Колір тексту">
                <span class="tiptap-color-swatch" style="background:#000000"></span>
                <input type="color" value="#000000" data-editor-action="color" data-path="${path}">
              </label>
              <button type="button" title="Жирний" aria-label="Жирний" data-editor-action="bold" data-path="${path}"><strong>B</strong></button>
              <button type="button" title="Курсив" aria-label="Курсив" data-editor-action="italic" data-path="${path}"><em>I</em></button>
              <button type="button" title="Підкреслення" aria-label="Підкреслення" data-editor-action="underline" data-path="${path}"><u>U</u></button>
              <button type="button" title="Закреслення" aria-label="Закреслення" data-editor-action="strike" data-path="${path}"><s>S</s></button>
            </div>

            <div class="tiptap-toolbar-group tiptap-toolbar-list-group">
              <button type="button" title="Маркований список" aria-label="Маркований список" data-editor-action="bulletList" data-path="${path}">•</button>
              <button type="button" title="Нумерований список" aria-label="Нумерований список" data-editor-action="orderedList" data-path="${path}">1.</button>
            </div>

            <div class="tiptap-toolbar-group tiptap-toolbar-align-group">
              <button type="button" title="Вирівняти ліворуч" aria-label="Вирівняти ліворуч" data-editor-action="alignLeft" data-path="${path}">←</button>
              <button type="button" title="Вирівняти по центру" aria-label="Вирівняти по центру" data-editor-action="alignCenter" data-path="${path}">↔</button>
              <button type="button" title="Вирівняти праворуч" aria-label="Вирівняти праворуч" data-editor-action="alignRight" data-path="${path}">→</button>
            </div>

            <div class="tiptap-toolbar-group tiptap-toolbar-insert-group">
              <button type="button" title="Додати посилання" aria-label="Додати посилання" data-editor-action="link" data-path="${path}">🔗</button>
              <button type="button" title="Зображення за URL" aria-label="Зображення за URL" data-editor-action="image" data-path="${path}">🖼</button>
              <button type="button" title="Вставити таблицю" aria-label="Вставити таблицю" data-editor-action="table" data-path="${path}">▦</button>
            </div>

            <div class="tiptap-toolbar-group tiptap-toolbar-table-group" data-table-controls="${path}">
              <button type="button" title="Додати рядок таблиці" aria-label="Додати рядок таблиці" data-editor-action="addRow" data-path="${path}">+R</button>
              <button type="button" title="Додати колонку таблиці" aria-label="Додати колонку таблиці" data-editor-action="addColumn" data-path="${path}">+C</button>
              <button type="button" title="Видалити таблицю" aria-label="Видалити таблицю" data-editor-action="deleteTable" data-path="${path}">×▦</button>
            </div>
          </div>

          <div class="tiptap-load-message" data-tiptap-message="${path}">
            Завантаження WYSIWYG-редактора...
          </div>

          <div class="tiptap-editor" data-field="text-html" data-editor-path="${path}">
            ${safeHtml}
          </div>

          <p class="muted-text">
            Редактор використовує Tiptap. Якщо панель не завантажилась, перевірте підключення до інтернету.
          </p>
        </div>
      `;
    }

    renderDimensionFields(data) {
      return `
        <div class="builder-dimensions">
          <label>
            Ширина
            <span class="dimension-row">
              <input data-field="widthValue" type="number" min="1" step="1" value="${escapeHtml(data.widthValue || "")}" placeholder="Напр. 600">
              <select data-field="widthUnit">
                <option value="px" ${data.widthUnit !== "%" ? "selected" : ""}>px</option>
                <option value="%" ${data.widthUnit === "%" ? "selected" : ""}>%</option>
              </select>
            </span>
          </label>
          <label>
            Висота
            <span class="dimension-row">
              <input data-field="heightValue" type="number" min="1" step="1" value="${escapeHtml(data.heightValue || "")}" placeholder="auto">
              <select data-field="heightUnit">
                <option value="px" ${data.heightUnit !== "%" ? "selected" : ""}>px</option>
                <option value="%" ${data.heightUnit === "%" ? "selected" : ""}>%</option>
              </select>
            </span>
          </label>
        </div>
        <p class="muted-text">Достатньо вказати ширину або висоту. Якщо висота порожня — пропорції зберігаються автоматично.</p>
      `;
    }

    renderMediaSummary(block, path) {
      const data = block.data || defaultData(block.type);
      const hasUrl = Boolean(String(data.url || "").trim());
      let preview = `<div class="media-placeholder">Медіа ще не додано. Натисніть «Налаштувати».</div>`;

      if (hasUrl && block.type === "IMAGE") {
        preview = `<img src="${escapeHtml(data.url)}" alt="${escapeHtml(data.alt || "")}">`;
      }

      if (hasUrl && block.type === "VIDEO") {
        preview = `<video controls src="${escapeHtml(data.url)}"></video>`;
      }

      if (hasUrl && block.type === "AUDIO") {
        preview = `<audio controls src="${escapeHtml(data.url)}"></audio>`;
      }

      return `
        <div class="media-editor-summary" data-media-preview-path="${path}" title="Подвійний клік — редагувати медіа" tabindex="0">
          ${preview}
        </div>
        <div class="media-editor-actions">
          <button type="button" data-action="edit-media" data-path="${path}">Редагувати</button>
        </div>
        <p class="muted-text media-editor-hint">Подвійний клік по медіаблоку відкриває форму редагування.</p>
      `;
    }

    renderMediaModalForm(block, path) {
      const data = block.data || defaultData(block.type);
      const isImage = block.type === "IMAGE";
      const isVideo = block.type === "VIDEO";
      const isAudio = block.type === "AUDIO";
      const title = isImage ? "Зображення" : isVideo ? "Відео" : "Аудіо";
      const accept = isImage ? "image/*" : isVideo ? "video/*" : "audio/*";
      const uploadAction = isImage ? "modal-upload-image" : isVideo ? "modal-upload-video" : "modal-upload-audio";

      return `
        <div class="modal-backdrop media-modal-backdrop" data-media-modal-path="${path}">
          <div class="modal-card media-modal-card" role="dialog" aria-modal="true" aria-label="${title}">
            <div class="modal-header">
              <h3>${title}</h3>
              <button type="button" class="icon-btn" data-media-modal-action="close" title="Закрити">×</button>
            </div>

            <label>URL ${title.toLowerCase()}
              <input data-modal-field="url" type="text" value="${escapeHtml(data.url || "")}" placeholder="https://... або /uploads/...">
            </label>

            <div class="builder-upload-row">
              <input data-modal-field="file" type="file" accept="${accept}">
              <button type="button" data-media-modal-action="${uploadAction}">Завантажити файл</button>
            </div>

            ${!isAudio ? this.renderModalDimensionFields(data) : ""}

            ${isImage ? `
              <label>Alt-текст
                <input data-modal-field="alt" type="text" value="${escapeHtml(data.alt || "")}" placeholder="Короткий опис зображення">
              </label>
              <label>Підпис під зображенням
                <input data-modal-field="caption" type="text" value="${escapeHtml(data.caption || "")}" placeholder="Необовʼязково">
              </label>
            ` : ""}

            <div class="modal-actions">
              <button type="button" data-media-modal-action="close">Скасувати</button>
              <button type="button" class="danger-btn" data-media-modal-action="delete">Видалити</button>
              <button type="button" data-media-modal-action="save">${String(data.url || "").trim() ? "Зберегти" : "Додати"}</button>
            </div>
          </div>
        </div>
      `;
    }

    renderModalDimensionFields(data) {
      return `
        <div class="builder-dimensions media-modal-dimensions">
          <label>Ширина
            <span class="dimension-row">
              <input data-modal-field="widthValue" type="number" min="1" step="1" value="${escapeHtml(data.widthValue || "")}" placeholder="Напр. 600">
              <select data-modal-field="widthUnit">
                <option value="px" ${data.widthUnit !== "%" ? "selected" : ""}>px</option>
                <option value="%" ${data.widthUnit === "%" ? "selected" : ""}>%</option>
              </select>
            </span>
          </label>
          <label>Висота
            <span class="dimension-row">
              <input data-modal-field="heightValue" type="number" min="1" step="1" value="${escapeHtml(data.heightValue || "")}" placeholder="auto">
              <select data-modal-field="heightUnit">
                <option value="px" ${data.heightUnit !== "%" ? "selected" : ""}>px</option>
                <option value="%" ${data.heightUnit === "%" ? "selected" : ""}>%</option>
              </select>
            </span>
          </label>
        </div>
        <p class="muted-text">Для зображення або відео вкажіть хоча б ширину або висоту.</p>
      `;
    }

    openMediaModal(path) {
      this.syncFromDom();
      const block = this.getBlockByPath(path);
      if (!block || !["IMAGE", "VIDEO", "AUDIO"].includes(block.type)) return;

      this.closeMediaModal();
      document.body.insertAdjacentHTML("beforeend", this.renderMediaModalForm(block, path));
      const modal = document.querySelector(`[data-media-modal-path="${path}"]`);
      modal?.querySelector(`[data-modal-field="url"]`)?.focus();

      modal?.addEventListener("click", async event => {
        if (event.target === modal) {
          this.closeMediaModal();
          return;
        }

        const action = event.target?.dataset?.mediaModalAction;
        if (!action) return;

        if (action === "close") this.closeMediaModal();
        if (action === "delete") {
          this.closeMediaModal();
          this.deleteBlock(path);
        }
        if (action === "save") this.saveMediaModal(path);
        if (action === "modal-upload-image") await this.uploadMediaFromModal(path, "image");
        if (action === "modal-upload-video") await this.uploadMediaFromModal(path, "video");
        if (action === "modal-upload-audio") await this.uploadMediaFromModal(path, "audio");
      });
    }

    closeMediaModal() {
      document.querySelectorAll(".media-modal-backdrop").forEach(item => item.remove());
    }

    saveMediaModal(path) {
      const modal = document.querySelector(`[data-media-modal-path="${path}"]`);
      const block = this.getBlockByPath(path);
      if (!modal || !block) return;

      const url = modal.querySelector(`[data-modal-field="url"]`)?.value.trim() || "";
      const widthValue = normalizeDimensionValue(modal.querySelector(`[data-modal-field="widthValue"]`)?.value);
      const heightValue = normalizeDimensionValue(modal.querySelector(`[data-modal-field="heightValue"]`)?.value);

      if (!url) {
        alert("Вкажіть URL або завантажте файл.");
        return;
      }

      if ((block.type === "IMAGE" || block.type === "VIDEO") && !widthValue && !heightValue) {
        alert("Вкажіть хоча б ширину або висоту.");
        return;
      }

      block.data.source = "URL";
      block.data.url = url;

      if (block.type === "IMAGE") {
        block.data.alt = modal.querySelector(`[data-modal-field="alt"]`)?.value || "";
        block.data.caption = modal.querySelector(`[data-modal-field="caption"]`)?.value || "";
      }

      if (block.type === "IMAGE" || block.type === "VIDEO") {
        block.data.widthValue = widthValue || "";
        block.data.widthUnit = normalizeUnit(modal.querySelector(`[data-modal-field="widthUnit"]`)?.value);
        block.data.heightValue = heightValue || "";
        block.data.heightUnit = normalizeUnit(modal.querySelector(`[data-modal-field="heightUnit"]`)?.value);
      }

      this.closeMediaModal();
      this.render();
      this.onChange();
    }

    async uploadMediaFromModal(path, kind) {
      const modal = document.querySelector(`[data-media-modal-path="${path}"]`);
      const input = modal?.querySelector(`[data-modal-field="file"]`);
      const file = input?.files?.[0];

      if (!file) {
        alert("Оберіть файл");
        return;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch(`/api/uploads/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, dataUrl })
      });

      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Помилка завантаження файлу");
        return;
      }

      const urlInput = modal.querySelector(`[data-modal-field="url"]`);
      if (urlInput) urlInput.value = result.url;
    }

    renderEditor(block, path) {
      const data = block.data || defaultData(block.type);

      if (block.type === "TEXT") {
        return this.renderTextEditor(block, path);
      }

      if (["IMAGE", "VIDEO", "AUDIO"].includes(block.type)) {
        return this.renderMediaSummary(block, path);
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

      if (block.type === "SECTION") {
        return this.renderSectionEditor(block, path);
      }

      return "";
    }

    renderSectionEditor(block, path) {
      const columns = block.data.columns || [];
      const sum = columns.reduce((acc, column) => acc + (Number(column.width) || 0), 0);
      const isValid = sum === 100 && columns.every(column => (Number(column.width) || 0) > 0);

      return `
        <div class="section-settings">
          <label>
            Кількість колонок
            <span class="section-column-count-row">
              <input data-section-column-count="${path}" type="number" min="1" max="4" step="1" value="${columns.length || 1}">
              <button type="button" data-action="update-section-columns" data-path="${path}">Оновити колонки</button>
            </span>
          </label>

          <div class="section-width-settings">
            ${columns.map((column, columnIndex) => `
              <label>
                Колонка ${columnIndex + 1}, %
                <input data-section-width="${path}:${columnIndex}" type="number" min="1" max="100" step="1" value="${escapeHtml(column.width || "")}">
              </label>
            `).join("")}
          </div>

          <div class="section-sum ${isValid ? "success-text" : "error-text"}">
            Сума: ${sum}% ${isValid ? "✓" : "— має дорівнювати 100%"}
          </div>
        </div>

        <div class="builder-section-columns">
          ${columns.map((column, columnIndex) => {
            const containerPath = `${path}:${columnIndex}`;
            const columnBlocks = column.blocks || [];
            return `
              <div class="builder-section-column" style="flex-basis:${Number(column.width) || 1}%;">
                <div class="builder-section-column-title">Колонка ${columnIndex + 1} — ${Number(column.width) || 0}%</div>
                <div class="builder-column-toolbar">
                  <button type="button" data-action="add" data-type="TEXT" data-container-path="${containerPath}">+ Текст</button>
                  <button type="button" data-action="add" data-type="IMAGE" data-container-path="${containerPath}">+ Зображення</button>
                  <button type="button" data-action="add" data-type="VIDEO" data-container-path="${containerPath}">+ Відео</button>
                  <button type="button" data-action="add" data-type="AUDIO" data-container-path="${containerPath}">+ Аудіо</button>
                  <button type="button" data-action="add" data-type="HTML" data-container-path="${containerPath}">+ HTML</button>
                </div>
                <div class="builder-column-blocks">
                  ${columnBlocks.length ? columnBlocks.map((child, childIndex) => this.renderBlock(child, `${containerPath}:${childIndex}`, columnBlocks.length)).join("") : `
                    <div class="builder-empty small-empty">Колонка порожня.</div>
                  `}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    async initTextEditors() {
      const textWrappers = Array.from(this.root.querySelectorAll("[data-text-editor-path]"));
      if (!textWrappers.length) return;

      let modules;
      try {
        modules = await loadTiptapModules();
      } catch (error) {
        textWrappers.forEach(wrapper => {
          const message = wrapper.querySelector(".tiptap-load-message");
          if (message) {
            message.textContent = "Не вдалося завантажити Tiptap. Можна редагувати HTML напряму, але панель форматування недоступна.";
            message.classList.add("error-text");
          }
          const editorElement = wrapper.querySelector(".tiptap-editor");
          if (editorElement) {
            editorElement.setAttribute("contenteditable", "true");
          }
        });
        return;
      }

      const ExtendedImage = modules.Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: element => element.getAttribute("width") || element.style.width || null,
              renderHTML: attributes => attributes.width ? { width: attributes.width, style: `width:${attributes.width};` } : {}
            },
            height: {
              default: null,
              parseHTML: element => element.getAttribute("height") || element.style.height || null,
              renderHTML: attributes => attributes.height ? { height: attributes.height, style: `height:${attributes.height};` } : {}
            }
          };
        }
      });

      const TextAppearance = modules.Extension.create({
        name: "textAppearance",
        addGlobalAttributes() {
          return [
            {
              types: ["textStyle"],
              attributes: {
                fontSize: {
                  default: null,
                  parseHTML: element => element.style.fontSize || null,
                  renderHTML: attributes => attributes.fontSize ? { style: `font-size:${attributes.fontSize};` } : {}
                },
                fontFamily: {
                  default: null,
                  parseHTML: element => element.style.fontFamily || null,
                  renderHTML: attributes => attributes.fontFamily ? { style: `font-family:${attributes.fontFamily};` } : {}
                }
              }
            }
          ];
        }
      });

      textWrappers.forEach(wrapper => {
        const path = wrapper.dataset.textEditorPath;
        const block = this.getBlockByPath(path);
        const editorElement = wrapper.querySelector(".tiptap-editor");
        const message = wrapper.querySelector(".tiptap-load-message");

        if (!block || !editorElement || this.textEditors.has(block.id)) return;

        const initialContent = block.data.html || textToHtml(block.data.text || "");
        editorElement.innerHTML = "";

        const editor = new modules.Editor({
          element: editorElement,
          content: initialContent,
          extensions: [
            modules.StarterKit,
            modules.Underline,
            modules.TextStyle,
            TextAppearance,
            modules.Color,
            modules.TextAlign.configure({
              types: ["heading", "paragraph", "listItem"]
            }),
            modules.Link.configure({
              openOnClick: false
            }),
            ExtendedImage.configure({
              inline: false,
              allowBase64: true
            }),
            modules.Table.configure({
              resizable: true
            }),
            modules.TableRow,
            modules.TableHeader,
            modules.TableCell
          ],
          editorProps: {
            attributes: {
              class: "tiptap-editor-surface"
            }
          },
          onUpdate: () => {
            this.updateTextToolbarState(path, editor);
            this.onChange();
          },
          onSelectionUpdate: () => {
            this.updateTextToolbarState(path, editor);
          }
        });

        this.textEditors.set(block.id, editor);
        this.updateTextToolbarState(path, editor);

        if (message) {
          message.textContent = "WYSIWYG-редактор готовий.";
          message.classList.add("success-text");
          setTimeout(() => {
            message.textContent = "";
            message.classList.remove("success-text");
          }, 1500);
        }
      });
    }

    getTextEditorByPath(path) {
      const block = this.getBlockByPath(path);
      if (!block) return null;
      return this.textEditors.get(block.id) || null;
    }

    applyTextAlignment(editor, alignment) {
      editor.chain().focus().setTextAlign(alignment).run();
    }

    normalizePromptDimension(value, unitFallback = "px") {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (raw.endsWith("%") || raw.endsWith("px")) return raw;
      const parsed = normalizeDimensionValue(raw);
      return parsed ? `${parsed}${unitFallback}` : "";
    }

    updateTextToolbarState(path, editor) {
      const wrapper = this.root?.querySelector(`[data-text-editor-path="${path}"]`);
      if (!wrapper || !editor) return;

      const tableControls = wrapper.querySelector(`[data-table-controls="${path}"]`);
      if (tableControls) {
        tableControls.classList.toggle("is-visible", editor.isActive("table"));
      }

      const textStyleAttrs = editor.getAttributes("textStyle") || {};

      const fontFamilySelect = wrapper.querySelector(`select[data-editor-action="fontFamily"]`);
      if (fontFamilySelect) {
        const currentFont = String(textStyleAttrs.fontFamily || "").replace(/["']/g, "").trim();
        const matchingFont = Array.from(fontFamilySelect.options).find(option => {
          const optionFont = String(option.value || "").replace(/["']/g, "").trim();
          return optionFont && currentFont && optionFont.toLowerCase() === currentFont.toLowerCase();
        });
        fontFamilySelect.value = matchingFont ? matchingFont.value : "";
      }

      const fontSizeSelect = wrapper.querySelector(`select[data-editor-action="fontSize"]`);
      if (fontSizeSelect) {
        const currentSize = String(textStyleAttrs.fontSize || "").trim();
        fontSizeSelect.value = Array.from(fontSizeSelect.options).some(option => option.value === currentSize) ? currentSize : "";
      }

      const colorInput = wrapper.querySelector(`input[type="color"][data-editor-action="color"]`);
      const currentColor = textStyleAttrs.color;
      if (colorInput) {
        colorInput.value = /^#[0-9a-f]{6}$/i.test(String(currentColor || "")) ? currentColor : "#000000";
        this.updateColorControl(colorInput);
      }
    }

    updateColorControl(control) {
      const swatch = control.closest(".compact-color-control")?.querySelector(".tiptap-color-swatch");
      if (swatch) swatch.style.background = control.value || "#000000";
    }

    handleTextEditorAction(event) {
      const control = event.currentTarget;
      const action = control.dataset.editorAction;
      const path = control.dataset.path;
      const editor = this.getTextEditorByPath(path);

      if (!editor) return;

      if (control.tagName === "SELECT" && event.type !== "change") {
        return;
      }

      if (control.tagName === "INPUT" && control.type === "color" && event.type !== "change") {
        return;
      }

      event.preventDefault();

      if (action === "fontFamily") {
        const value = control.value || null;
        const chain = editor.chain().focus();
        if (value) chain.setMark("textStyle", { fontFamily: value }).run();
        else chain.setMark("textStyle", { fontFamily: null }).run();
      }

      if (action === "fontSize") {
        const value = control.value || null;
        const chain = editor.chain().focus();
        if (value) chain.setMark("textStyle", { fontSize: value }).run();
        else chain.setMark("textStyle", { fontSize: null }).run();
      }
      if (action === "bold") editor.chain().focus().toggleBold().run();
      if (action === "italic") editor.chain().focus().toggleItalic().run();
      if (action === "underline") editor.chain().focus().toggleUnderline().run();
      if (action === "strike") editor.chain().focus().toggleStrike().run();
      if (action === "bulletList") editor.chain().focus().toggleBulletList().run();
      if (action === "orderedList") editor.chain().focus().toggleOrderedList().run();
      if (action === "alignLeft") this.applyTextAlignment(editor, "left");
      if (action === "alignCenter") this.applyTextAlignment(editor, "center");
      if (action === "alignRight") this.applyTextAlignment(editor, "right");
      if (action === "color") {
        editor.chain().focus().setColor(control.value || "#000000").run();
        this.updateColorControl(control);
      }

      if (action === "link") {
        const previousUrl = editor.getAttributes("link").href || "";
        const url = prompt("Введіть URL посилання", previousUrl);

        if (url === null) return;

        if (!url.trim()) {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          return;
        }

        editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
      }

      if (action === "image") {
        const url = prompt("Введіть URL зображення");
        if (!url || !url.trim()) return;

        const width = this.normalizePromptDimension(prompt("Ширина зображення. Наприклад: 400, 400px або 50%", "600px"));
        const height = this.normalizePromptDimension(prompt("Висота зображення. Можна залишити порожньою для збереження пропорцій", ""));

        if (!width && !height) {
          alert("Вкажіть хоча б ширину або висоту зображення.");
          return;
        }

        editor.chain().focus().setImage({ src: url.trim(), width, height }).run();
      }

      if (action === "table") editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      if (action === "addRow") editor.chain().focus().addRowAfter().run();
      if (action === "addColumn") editor.chain().focus().addColumnAfter().run();
      if (action === "deleteTable") editor.chain().focus().deleteTable().run();

      this.updateTextToolbarState(path, editor);
      this.onChange();
    }

    async uploadImage(path) {
      this.syncFromDom();
      const wrapper = this.root.querySelector(`[data-builder-path="${path}"]`);
      const input = wrapper?.querySelector(`[data-field="file"]`);
      const file = input?.files?.[0];
      const block = this.getBlockByPath(path);

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

      block.data.source = "UPLOAD";
      block.data.url = result.url;
      this.render();
      this.onChange();
    }

    async uploadAudio(path) {
      this.syncFromDom();
      const wrapper = this.root.querySelector(`[data-builder-path="${path}"]`);
      const input = wrapper?.querySelector(`[data-field="audioFile"]`);
      const file = input?.files?.[0];
      const block = this.getBlockByPath(path);

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

      block.data.source = "UPLOAD";
      block.data.url = result.url;
      this.render();
      this.onChange();
    }

    openPreview(title) {
      this.syncFromDom();
      const invalidSections = this.validateSections();
      if (invalidSections.length) {
        alert("У секціях сума ширин колонок має дорівнювати 100%.");
        return;
      }

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
