(function () {
  "use strict";

  const apiUrl = "/api/admin-wishes";
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

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindLogin();
    bindToolbar();

    if (getToken()) {
      showDashboard();
      loadWishes();
    }
  }

  function bindLogin() {
    const form = document.getElementById("loginForm");
    const input = document.getElementById("adminToken");

    input.value = getToken();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const token = input.value.trim();

      if (!token) {
        toast("请输入管理口令");
        return;
      }

      localStorage.setItem(tokenKey, token);
      showDashboard();
      await loadWishes();
    });
  }

  function bindToolbar() {
    document.getElementById("refreshBtn").addEventListener("click", loadWishes);
    document.getElementById("logoutBtn").addEventListener("click", () => {
      localStorage.removeItem(tokenKey);
      wishes = [];
      document.getElementById("dashboard").hidden = true;
      document.getElementById("loginPanel").hidden = false;
      document.getElementById("adminToken").value = "";
      toast("已退出后台");
    });
    document.getElementById("searchInput").addEventListener("input", renderWishes);
    document.getElementById("statusFilter").addEventListener("change", renderWishes);
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
      throw new Error(data.error || "请求失败");
    }

    return data;
  }

  function replaceWish(nextWish) {
    wishes = wishes.map((wish) => wish.id === nextWish.id ? nextWish : wish);
  }

  function showDashboard() {
    document.getElementById("loginPanel").hidden = true;
    document.getElementById("dashboard").hidden = false;
  }

  function getToken() {
    return localStorage.getItem(tokenKey) || "";
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
