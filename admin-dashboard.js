(function () {
  "use strict";

  const apiUrl = "/api/admin-wishes";
  const securityApiUrl = "/api/security-settings";
  const notificationApiUrl = "/api/notification-settings";
  const loginUrl = "./admin.html";
  const tokenKey = "wishWallAdminToken";
  const typeLabels = {
    love: "Love",
    wish: "心愿",
    feedback: "反馈"
  };
  const statusLabels = {
    "": "无",
    doing: "进行中",
    done: "已达成"
  };

  let wishes = [];
  let notificationLogs = [];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (!getToken()) {
      redirectToLogin();
      return;
    }

    bindMenu();
    bindToolbar();
    bindSecurityForm();
    bindNotificationForm();
    loadWishes();
    loadSecuritySettings();
    loadNotificationSettings();
  }

  function bindMenu() {
    if (!panelText[panelId]) {
      panelText[panelId] = {
        title: "通知管理",
        desc: "配置新留言邮件通知，查看每次通知是否已经送达。"
      };
    }

    document.querySelectorAll(".sidebar-menu-btn").forEach((button) => {
      button.addEventListener("click", () => {
        showPanel(button.dataset.panel);
      });
    });
  }

  function bindToolbar() {
    document.getElementById("refreshBtn").addEventListener("click", loadWishes);
    document.getElementById("logoutBtn").addEventListener("click", () => {
      sessionStorage.removeItem(tokenKey);
      redirectToLogin();
    });
    document.getElementById("searchInput").addEventListener("input", renderWishes);
    document.getElementById("statusFilter").addEventListener("change", renderWishes);
  }

  function bindSecurityForm() {
    document.getElementById("securityForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveSecuritySettings();
    });
    document.getElementById("reloadSecurityBtn").addEventListener("click", loadSecuritySettings);
  }

  function bindNotificationForm() {
    document.getElementById("notificationForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveNotificationSettings();
    });
    document.getElementById("reloadNotificationBtn").addEventListener("click", loadNotificationSettings);
    document.getElementById("testNotificationBtn").addEventListener("click", sendTestNotification);
    document.getElementById("notificationProvider").addEventListener("change", updateProviderCards);
  }

  function showPanel(panelId) {
    const panelText = {
      wishesPanel: {
        title: "留言管理",
        desc: "审核留言、隐藏不合适内容、更新心愿状态，把这面墙照顾得干净又有生命力。"
      },
      securityPanel: {
        title: "安全管理",
        desc: "配置 IP 记录、每日留言限制和验证码，让公开墙面更稳、更少被刷屏。"
      }
    };

    document.querySelectorAll(".sidebar-menu-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.panel === panelId);
    });
    document.querySelectorAll(".admin-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === panelId);
    });

    document.getElementById("panelTitle").textContent = panelText[panelId].title;
    document.getElementById("panelDesc").textContent = panelText[panelId].desc;
  }

  async function loadWishes() {
    try {
      const data = await requestJson(apiUrl);
      wishes = data.wishes || [];
      renderStats();
      renderWishes();
      toast("后台数据已刷新");
    } catch (error) {
      console.error(error);

      if (error.status === 401) {
        sessionStorage.removeItem(tokenKey);
        redirectToLogin();
        return;
      }

      toast(error.message || "读取后台数据失败");
    }
  }

  function renderStats() {
    const total = wishes.length;
    const approved = wishes.filter((wish) => wish.approved).length;
    const done = wishes.filter((wish) => wish.status === "done").length;

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statApproved").textContent = approved;
    document.getElementById("statHidden").textContent = total - approved;
    document.getElementById("statDone").textContent = done;
  }

  function renderWishes() {
    const list = document.getElementById("wishList");
    const empty = document.getElementById("emptyState");
    const template = document.getElementById("wishAdminTemplate");
    const filtered = getFilteredWishes();

    list.innerHTML = "";
    filtered.forEach((wish) => {
      const card = template.content.firstElementChild.cloneNode(true);
      card.dataset.id = wish.id;
      fillCard(card, wish);
      list.appendChild(card);
    });

    empty.hidden = filtered.length > 0;
  }

  function fillCard(card, wish) {
    card.querySelector(".type-pill").textContent = `${typeLabels[wish.type] || wish.type} / ${statusLabels[wish.status] || "无"}`;

    const visibility = card.querySelector(".visibility-pill");
    visibility.textContent = wish.approved ? "公开显示" : "已隐藏";
    visibility.classList.toggle("hidden", !wish.approved);

    card.querySelector("time").textContent = formatDate(wish.createdAt);
    card.querySelector(".content-input").value = wish.content || "";
    card.querySelector(".nickname-input").value = wish.nickname || "匿名";
    card.querySelector(".type-input").value = wish.type || "love";
    card.querySelector(".color-input").value = wish.color || "green";
    card.querySelector(".status-input").value = wish.status || "";
    card.querySelector(".done-note-input").value = wish.doneNote || "";
    card.querySelector(".done-image-input").value = wish.doneImage || "";
    card.querySelector(".ai-reply-input").value = wish.aiReply || "";

    const toggleButton = card.querySelector(".toggle-approve-btn");
    toggleButton.textContent = wish.approved ? "隐藏" : "公开";
    toggleButton.classList.toggle("hide", wish.approved);
    toggleButton.addEventListener("click", () => updateWish(wish.id, { approved: !wish.approved }));

    card.querySelector(".save-btn").addEventListener("click", () => saveCard(card, wish.id));
    card.querySelector(".detail-btn").addEventListener("click", () => showWishDetail(wish));
    card.querySelector(".delete-btn").addEventListener("click", () => deleteWish(wish.id));
  }

  async function saveCard(card, id) {
    const payload = {
      id,
      content: card.querySelector(".content-input").value,
      nickname: card.querySelector(".nickname-input").value,
      type: card.querySelector(".type-input").value,
      color: card.querySelector(".color-input").value,
      status: card.querySelector(".status-input").value,
      doneNote: card.querySelector(".done-note-input").value,
      doneImage: card.querySelector(".done-image-input").value,
      aiReply: card.querySelector(".ai-reply-input").value
    };

    await updateWish(id, payload);
  }

  async function updateWish(id, payload) {
    try {
      const data = await requestJson(apiUrl, {
        method: "PATCH",
        body: JSON.stringify({ id, ...payload })
      });
      replaceWish(data.wish);
      renderStats();
      renderWishes();
      toast("已保存");
    } catch (error) {
      console.error(error);
      toast(error.message || "保存失败");
    }
  }

  async function deleteWish(id) {
    const wish = wishes.find((item) => item.id === id);
    const preview = wish ? `“${wish.content.slice(0, 18)}”` : "这条留言";

    if (!window.confirm(`确定删除 ${preview} 吗？这个操作不可恢复。`)) {
      return;
    }

    try {
      await requestJson(`${apiUrl}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      wishes = wishes.filter((item) => item.id !== id);
      renderStats();
      renderWishes();
      toast("已删除");
    } catch (error) {
      console.error(error);
      toast(error.message || "删除失败");
    }
  }

  function showWishDetail(wish) {
    const lines = [
      `留言 ID：${wish.id}`,
      `昵称：${wish.nickname || "匿名"}`,
      `分类：${typeLabels[wish.type] || wish.type}`,
      `状态：${statusLabels[wish.status] || "无"}`,
      `发布时间：${formatDate(wish.createdAt)}`,
      `IP：${wish.ipRecorded && wish.ipAddress ? wish.ipAddress : "未记录"}`
    ];

    window.alert(lines.join("\n"));
  }

  async function loadSecuritySettings() {
    try {
      const data = await requestJson(securityApiUrl);
      fillSecurityForm(data.settings || {});
    } catch (error) {
      console.error(error);
      toast(error.message || "读取安全设置失败");
    }
  }

  async function saveSecuritySettings() {
    const button = document.getElementById("saveSecurityBtn");
    const payload = {
      recordIp: document.getElementById("recordIp").checked,
      dailyLimitEnabled: document.getElementById("dailyLimitEnabled").checked,
      dailyLimitCount: document.getElementById("dailyLimitCount").value,
      captchaEnabled: document.getElementById("captchaEnabled").checked,
      adminCaptchaEnabled: document.getElementById("adminCaptchaEnabled").checked,
      captchaSiteKey: document.getElementById("captchaSiteKey").value,
      captchaSecret: document.getElementById("captchaSecret").value,
      captchaVerifyUrl: document.getElementById("captchaVerifyUrl").value,
      captchaHelp: document.getElementById("captchaHelp").value
    };

    button.disabled = true;
    button.textContent = "保存中...";

    try {
      const data = await requestJson(securityApiUrl, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      fillSecurityForm(data.settings || {});
      toast("安全设置已保存");
    } catch (error) {
      console.error(error);
      toast(error.message || "保存安全设置失败");
    } finally {
      button.disabled = false;
      button.textContent = "保存安全设置";
    }
  }

  function fillSecurityForm(settings) {
    document.getElementById("recordIp").checked = Boolean(settings.recordIp);
    document.getElementById("dailyLimitEnabled").checked = Boolean(settings.dailyLimitEnabled);
    document.getElementById("dailyLimitCount").value = settings.dailyLimitCount || 5;
    document.getElementById("captchaEnabled").checked = Boolean(settings.captchaEnabled);
    document.getElementById("adminCaptchaEnabled").checked = Boolean(settings.adminCaptchaEnabled);
    document.getElementById("captchaSiteKey").value = settings.captchaSiteKey || "";
    document.getElementById("captchaSecret").value = settings.captchaSecret || "";
    document.getElementById("captchaVerifyUrl").value = settings.captchaVerifyUrl || "";
    document.getElementById("captchaHelp").value = settings.captchaHelp || "";
  }

  async function loadNotificationSettings() {
    try {
      const data = await requestJson(notificationApiUrl);
      fillNotificationForm(data.settings || {});
      notificationLogs = data.logs || [];
      renderNotificationLogs();
    } catch (error) {
      console.error(error);
      toast(error.message || "读取通知设置失败");
    }
  }

  async function saveNotificationSettings() {
    const button = document.getElementById("saveNotificationBtn");
    const payload = getNotificationPayload();

    button.disabled = true;
    button.textContent = "保存中...";

    try {
      const data = await requestJson(notificationApiUrl, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      fillNotificationForm(data.settings || {});
      toast("通知设置已保存");
    } catch (error) {
      console.error(error);
      toast(error.message || "保存通知设置失败");
    } finally {
      button.disabled = false;
      button.textContent = "保存通知设置";
    }
  }

  async function sendTestNotification() {
    const button = document.getElementById("testNotificationBtn");

    button.disabled = true;
    button.textContent = "发送中...";

    try {
      await saveNotificationSettings();
      await requestJson(notificationApiUrl, {
        method: "POST",
        body: JSON.stringify({ action: "test" })
      });
      await loadNotificationSettings();
      toast("测试邮件已发送");
    } catch (error) {
      console.error(error);
      await loadNotificationSettings();
      toast(error.message || "测试邮件发送失败");
    } finally {
      button.disabled = false;
      button.textContent = "发送测试邮件";
    }
  }

  function getNotificationPayload() {
    return {
      enabled: document.getElementById("notificationEnabled").checked,
      provider: document.getElementById("notificationProvider").value,
      recipientEmail: document.getElementById("notificationRecipientEmail").value,
      senderEmail: document.getElementById("notificationSenderEmail").value,
      senderName: document.getElementById("notificationSenderName").value,
      subjectPrefix: document.getElementById("notificationSubjectPrefix").value,
      brevoApiKey: document.getElementById("brevoApiKey").value,
      smtpHost: document.getElementById("smtpHost").value,
      smtpPort: document.getElementById("smtpPort").value,
      smtpSecure: document.getElementById("smtpSecure").checked,
      smtpUser: document.getElementById("smtpUser").value,
      smtpPass: document.getElementById("smtpPass").value
    };
  }

  function fillNotificationForm(settings) {
    document.getElementById("notificationEnabled").checked = Boolean(settings.enabled);
    document.getElementById("notificationProvider").value = settings.provider || "brevo";
    document.getElementById("notificationRecipientEmail").value = settings.recipientEmail || "";
    document.getElementById("notificationSenderEmail").value = settings.senderEmail || "";
    document.getElementById("notificationSenderName").value = settings.senderName || "Wish Wall";
    document.getElementById("notificationSubjectPrefix").value = settings.subjectPrefix || "New wish";
    document.getElementById("brevoApiKey").value = settings.brevoApiKey || "";
    document.getElementById("smtpHost").value = settings.smtpHost || "";
    document.getElementById("smtpPort").value = settings.smtpPort || 587;
    document.getElementById("smtpSecure").checked = Boolean(settings.smtpSecure);
    document.getElementById("smtpUser").value = settings.smtpUser || "";
    document.getElementById("smtpPass").value = settings.smtpPass || "";
    updateProviderCards();
  }

  function updateProviderCards() {
    const provider = document.getElementById("notificationProvider").value;
    document.querySelectorAll("[data-provider-card]").forEach((card) => {
      card.hidden = card.dataset.providerCard !== provider;
    });
  }

  function renderNotificationLogs() {
    const list = document.getElementById("notificationList");
    const empty = document.getElementById("notificationEmptyState");
    list.innerHTML = "";

    notificationLogs.forEach((item) => {
      const row = document.createElement("article");
      row.className = "notification-item";
      row.innerHTML = `
        <div>
          <span class="notification-status ${item.status || ""}">${notificationStatusText(item.status)}</span>
          <strong>${escapeHtml(item.subject || "通知")}</strong>
          <p>${escapeHtml(item.recipientEmail || "")}</p>
          ${item.errorMessage ? `<p class="notification-error">${escapeHtml(item.errorMessage)}</p>` : ""}
        </div>
        <div class="notification-meta">
          <span>${escapeHtml(item.provider || "")}</span>
          <time>${formatDate(item.createdAt)}</time>
        </div>
      `;
      list.appendChild(row);
    });

    empty.hidden = notificationLogs.length > 0;
  }

  function notificationStatusText(status) {
    if (status === "sent") {
      return "已发送";
    }
    if (status === "failed") {
      return "发送失败";
    }
    if (status === "skipped") {
      return "已跳过";
    }
    return status || "未知";
  }

  function getFilteredWishes() {
    const keyword = document.getElementById("searchInput").value.trim().toLowerCase();
    const status = document.getElementById("statusFilter").value;

    return wishes.filter((wish) => {
      const matchedKeyword = !keyword
        || (wish.content || "").toLowerCase().includes(keyword)
        || (wish.nickname || "").toLowerCase().includes(keyword);
      const matchedStatus = status === "all"
        || (status === "approved" && wish.approved)
        || (status === "hidden" && !wish.approved)
        || wish.status === status;

      return matchedKeyword && matchedStatus;
    });
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(data.error || "请求失败");
      error.status = response.status;
      throw error;
    }

    return data;
  }

  function replaceWish(nextWish) {
    wishes = wishes.map((wish) => wish.id === nextWish.id ? nextWish : wish);
  }

  function redirectToLogin() {
    window.location.href = loginUrl;
  }

  function getToken() {
    return sessionStorage.getItem(tokenKey) || "";
  }

  function formatDate(dateText) {
    const date = new Date(dateText);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toast(message) {
    const toastEl = document.getElementById("toast");
    toastEl.textContent = message;
    toastEl.classList.add("show");
    window.clearTimeout(toastEl.timer);
    toastEl.timer = window.setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2200);
  }
})();
