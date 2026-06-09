export type LoginState = 'dashboard-ready' | 'select-identity' | 'login-page' | 'loading-or-unknown';

type LoginStatePage = {
  url: () => string;
  locator: (selector: string) => { count: () => Promise<number> };
};

export async function classifyLoginState(page: LoginStatePage): Promise<LoginState> {
  const url = page.url();

  if (url.includes('select-identity')) {
    return 'select-identity';
  }

  if ((await page.locator('.ant-table table').count()) > 0) {
    return 'dashboard-ready';
  }

  if (/auth\.alipay\.com|login|qr/i.test(url)) {
    return 'login-page';
  }

  return 'loading-or-unknown';
}

export async function waitForSettledLoginState(
  page: LoginStatePage,
  options: { timeoutMs: number; intervalMs: number; loginPageGraceMs?: number },
): Promise<LoginState> {
  const deadline = Date.now() + options.timeoutMs;
  const loginPageGraceMs = options.loginPageGraceMs ?? 10000;
  let loginPageSince: number | null = null;

  while (Date.now() <= deadline) {
    const state = await classifyLoginState(page);
    if (state === 'login-page') {
      loginPageSince ??= Date.now();
      if (Date.now() - loginPageSince >= loginPageGraceMs) {
        return 'login-page';
      }

      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
      continue;
    }

    loginPageSince = null;

    if (state !== 'loading-or-unknown') {
      return state;
    }

    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }

  return 'loading-or-unknown';
}

type LoginWaitPage = {
  waitForURL: (url: RegExp, options: { timeout: number }) => Promise<unknown>;
  waitForSelector: (selector: string, options: { timeout: number }) => Promise<unknown>;
};

export async function waitForDashboardAfterLogin(page: LoginWaitPage): Promise<void> {
  console.log('检测到支付宝登录页，请在打开的浏览器窗口扫码登录；登录成功后程序会自动继续抓取。');
  await page.waitForURL(/assistant-data-analysis\/index\/product\/list|select-identity/, { timeout: 300000 });
  await page.waitForSelector('.ant-table table', { timeout: 300000 });
}
