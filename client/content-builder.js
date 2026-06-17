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
      this.render();
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

        if (block.type === "IMAGE") {
          block.data.source = wrapper.querySelector(`[data-field="source"]`)?.value || "URL";
          block.data.url = wrapper.querySelector(`[data-field="url"]`)?.value || "";
          block.data.alt = wrapper.querySelector(`[data-field="alt"]`)?.value || "";
          block.data.caption = wrapper.querySelector(`[data-field="caption"]`)?.value || "";
          block.data.widthValue = normalizeDimensionValue(wrapper.querySelector(`[data-field="widthValue"]`)?.value) || "600";
          block.data.widthUnit = normalizeUnit(wrapper.querySelector(`[data-field="widthUnit"]`)?.value);
          block.data.heightValue = normalizeDimensionValue(wrapper.querySelector(`[data-field="heightValue"]`)?.value);
          block.data.heightUnit = normalizeUnit(wrapper.querySelector(`[data-field="heightUnit"]`)?.value);
        }

        if (block.type === "VIDEO") {
          block.data.url = wrapper.querySelector(`[data-field="url"]`)?.value || "";
          block.data.widthValue = normalizeDimensionValue(wrapper.querySelector(`[data-field="widthValue"]`)?.value) || "720";
          block.data.widthUnit = normalizeUnit(wrapper.querySelector(`[data-field="widthUnit"]`)?.value);
          block.data.heightValue = normalizeDimensionValue(wrapper.querySelector(`[data-field="heightValue"]`)?.value);
          block.data.heightUnit = normalizeUnit(wrapper.querySelector(`[data-field="heightUnit"]`)?.value);
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
          if (action === "upload-image") await this.uploadImage(path);
          if (action === "upload-audio") await this.uploadAudio(path);
          if (action === "update-section-columns") this.updateSectionColumns(path);
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
          <div class="tiptap-toolbar">
            <button type="button" data-editor-action="paragraph" data-path="${path}">Текст</button>
            <button type="button" data-editor-action="heading2" data-path="${path}">H2</button>
            <button type="button" data-editor-action="bold" data-path="${path}"><strong>B</strong></button>
            <button type="button" data-editor-action="italic" data-path="${path}"><em>I</em></button>
            <button type="button" data-editor-action="underline" data-path="${path}"><u>U</u></button>
            <button type="button" data-editor-action="bulletList" data-path="${path}">• список</button>
            <button type="button" data-editor-action="orderedList" data-path="${path}">1. список</button>
            <button type="button" data-editor-action="alignLeft" data-path="${path}">←</button>
            <button type="button" data-editor-action="alignCenter" data-path="${path}">↔</button>
            <button type="button" data-editor-action="alignRight" data-path="${path}">→</button>
            <label class="tiptap-color-label">
              Колір
              <input type="color" value="#111827" data-editor-action="color" data-path="${path}">
            </label>
            <button type="button" data-editor-action="link" data-path="${path}">Посилання</button>
            <button type="button" data-editor-action="image" data-path="${path}">Картинка URL</button>
            <button type="button" data-editor-action="table" data-path="${path}">Таблиця</button>
            <button type="button" data-editor-action="addRow" data-path="${path}">+ рядок</button>
            <button type="button" data-editor-action="addColumn" data-path="${path}">+ колонка</button>
            <button type="button" data-editor-action="deleteTable" data-path="${path}">× таблиця</button>
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

    renderEditor(block, path) {
      const data = block.data || defaultData(block.type);

      if (block.type === "TEXT") {
        return this.renderTextEditor(block, path);
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
            <button type="button" data-action="upload-image" data-path="${path}">Завантажити</button>
          </div>

          ${this.renderDimensionFields(data)}

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
          ${this.renderDimensionFields(data)}
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
            <button type="button" data-action="upload-audio" data-path="${path}">Завантажити аудіо</button>
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
            this.onChange();
          }
        });

        this.textEditors.set(block.id, editor);

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

    handleTextEditorAction(event) {
      const control = event.currentTarget;
      const action = control.dataset.editorAction;
      const path = control.dataset.path;
      const editor = this.getTextEditorByPath(path);

      if (!editor) return;

      if (control.tagName === "INPUT" && control.type === "color" && event.type !== "change") {
        return;
      }

      event.preventDefault();

      if (action === "paragraph") editor.chain().focus().setParagraph().run();
      if (action === "heading2") editor.chain().focus().toggleHeading({ level: 2 }).run();
      if (action === "bold") editor.chain().focus().toggleBold().run();
      if (action === "italic") editor.chain().focus().toggleItalic().run();
      if (action === "underline") editor.chain().focus().toggleUnderline().run();
      if (action === "bulletList") editor.chain().focus().toggleBulletList().run();
      if (action === "orderedList") editor.chain().focus().toggleOrderedList().run();
      if (action === "alignLeft") this.applyTextAlignment(editor, "left");
      if (action === "alignCenter") this.applyTextAlignment(editor, "center");
      if (action === "alignRight") this.applyTextAlignment(editor, "right");
      if (action === "color") editor.chain().focus().setColor(control.value || "#111827").run();

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
