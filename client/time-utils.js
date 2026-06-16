(function () {
  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function parseUtcDate(value) {
    if (!value) {
      return null;
    }

    const text = String(value).trim();

    if (!text) {
      return null;
    }

    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
    const normalized = text.includes("T") ? text : text.replace(" ", "T");
    const date = new Date(hasTimezone ? normalized : `${normalized}Z`);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date;
  }

  function formatLocalDateTime(value, options = {}) {
    const date = parseUtcDate(value);

    if (!date) {
      return "-";
    }

    return date.toLocaleString("uk-UA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: options.seconds === false ? undefined : "2-digit"
    });
  }

  function formatLocalDateTimeForList(value) {
    const date = parseUtcDate(value);

    if (!date) {
      return "-";
    }

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());

    return `${year}-${month}-${day} ${hour}:${minute}`;
  }

  function formatLocalTime(value) {
    const date = parseUtcDate(value);

    if (!date) {
      return "-";
    }

    return date.toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function toUtcSqlFromLocalDateTime(dateValue, timeValue) {
    if (!dateValue || !timeValue) {
      return null;
    }

    const localDate = new Date(`${dateValue}T${timeValue}`);

    if (Number.isNaN(localDate.getTime())) {
      return null;
    }

    return localDate
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
  }

  function splitUtcToLocalDateTime(value) {
    const date = parseUtcDate(value);

    if (!date) {
      return { date: "", time: "" };
    }

    return {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
    };
  }

  window.QETime = {
    parseUtcDate,
    formatLocalDateTime,
    formatLocalDateTimeForList,
    formatLocalTime,
    toUtcSqlFromLocalDateTime,
    splitUtcToLocalDateTime
  };
})();
