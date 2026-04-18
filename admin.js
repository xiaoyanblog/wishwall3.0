(function () {
  "use strict";

  const apiUrl = "/api/admin-wishes";
  const securityApiUrl = "/api/security-settings?public=true";
  const dashboardUrl = "./admin-dashboard.html";
  const tokenKey = "wishWallAdminToken";

  let securitySettings = {
    adminCaptchaEnabled: false,
    captchaSiteKey: "",
    captchaHelp: ""
  };
  let captchaWidgetId = null;
  let captchaScriptLoading = null;
  let captchaResponseToken = "";
  let securitySettingsLoading = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    const form = document.getElementById("loginForm");
    const input = document.getElementById("adminToken");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await login(input.value.trim());
    });

    securitySettingsLoading = loadSecuritySettings();
    await securitySettingsLoading;
  }

  async function login(token) {
    const button = document.getElementById("loginButton");

    clearError();
    if (securitySettingsLoading) {
      await securitySettingsLoading;
    }

    if (!token) {
      showError("请输入管理口令");
      return;
    }

    if (securitySettings.adminCaptchaEnabled && !captchaResponseToken) {
      showError("请先完成验证码");
      await showCaptcha();
      return;
    }

    button.disabled = true;
    button.textContent = "验证中...";

    try {
      await requestJson(`${apiUrl}?verify=true`, token, captchaResponseToken);
      sessionStorage.setItem(tokenKey, token);
      window.location.href = dashboardUrl;
    } catch (error) {
      sessionStorage.removeItem(tokenKey);
      resetCaptchaWidget();
      showError(error.message || "管理口令不正确");
      toast("口令或验证码错误，未进入后台");
    } finally {
      button.disabled = false;
      button.textContent = "进入后台";
    }
  }

  async function loadSecuritySettings() {
    try {
      const response = await fetch(securityApiUrl, { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "读取安全设置失败");
      }

      securitySettings = {
        ...securitySettings,
        ...(data.settings || {})
      };

      if (securitySettings.adminCaptchaEnabled) {
        await showCaptcha();
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function showCaptcha() {
    const captcha = document.getElementById("loginCaptcha");
    const hint = document.getElementById("loginCaptchaHint");

    if (!securitySettings.captchaSiteKey) {
      showError("验证码 Site Key 尚未配置");
      return;
    }

    captcha.hidden = false;
    hint.textContent = securitySettings.captchaHelp || "请先完成验证码";

    try {
      await loadHCaptcha();
      renderHCaptcha();
    } catch (error) {
      console.error(error);
      showError("验证码加载失败，请稍后再试");
    }
  }

  function loadHCaptcha() {
    if (window.hcaptcha) {
      return Promise.resolve();
    }

    if (captchaScriptLoading) {
      return captchaScriptLoading;
    }

    captchaScriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    return captchaScriptLoading;
  }

  function renderHCaptcha() {
    const container = document.getElementById("loginCaptchaWidget");

    if (captchaWidgetId !== null) {
      window.hcaptcha.reset(captchaWidgetId);
      captchaResponseToken = "";
      return;
    }

    captchaWidgetId = window.hcaptcha.render(container, {
      sitekey: securitySettings.captchaSiteKey,
      callback: (token) => {
        captchaResponseToken = token;
        clearError();
      },
      "expired-callback": () => {
        captchaResponseToken = "";
        showError("验证码已过期，请重新验证");
      },
      "error-callback": () => {
        captchaResponseToken = "";
        showError("验证码验证出错，请重试");
      }
    });
  }

  function resetCaptchaWidget() {
    captchaResponseToken = "";

    if (window.hcaptcha && captchaWidgetId !== null) {
      window.hcaptcha.reset(captchaWidgetId);
    }
  }

  async function requestJson(url, token, captchaToken = "") {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "X-Admin-Captcha-Token": captchaToken
      }
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "验证失败");
    }

    return data;
  }

  function showError(message) {
    const errorEl = document.getElementById("loginError");
    errorEl.textContent = message;
    errorEl.classList.add("show");
  }

  function clearError() {
    const errorEl = document.getElementById("loginError");
    errorEl.textContent = "";
    errorEl.classList.remove("show");
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
