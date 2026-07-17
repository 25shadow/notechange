import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, type BrowserContext, type Page } from 'playwright';

type PersistentContextOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

export interface PersistentContextLauncher {
  launchPersistentContext(
    userDataDirectory: string,
    options: PersistentContextOptions
  ): Promise<BrowserContext>;
}

type ManagedContext = {
  context: BrowserContext;
  userDataDirectory: string;
};

export type BrowserMode = 'headed' | 'headless';

export class SessionManager {
  private readonly contexts = new Map<string, ManagedContext>();

  constructor(
    private readonly launchOptions: PersistentContextOptions = { headless: false },
    private readonly rootDirectory = join(tmpdir(), 'notechange-browser'),
    private readonly launcher: PersistentContextLauncher = chromium
  ) {}

  async open(provider: string, url: string, mode: BrowserMode = 'headed'): Promise<Page> {
    await this.dispose(provider);
    const safeProvider = provider.replace(/[^a-z0-9_-]/gi, '_');
    const userDataDirectory = join(this.rootDirectory, safeProvider);
    await mkdir(userDataDirectory, { recursive: true });
    return this.launch(provider, url, userDataDirectory, mode);
  }

  getPage(provider: string): Page | null {
    const managed = this.contexts.get(provider);
    if (!managed) return null;
    return managed.context.pages()[0] ?? null;
  }

  async switchToHeadless(provider: string, url: string): Promise<Page> {
    return this.switchMode(provider, url, 'headless');
  }

  async switchToHeaded(provider: string, url: string): Promise<Page> {
    return this.switchMode(provider, url, 'headed');
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.contexts.keys()].map((provider) => this.dispose(provider)));
  }

  private async switchMode(provider: string, url: string, mode: BrowserMode): Promise<Page> {
    const managed = this.contexts.get(provider);
    if (!managed) throw new Error(`LOGIN_SESSION_MISSING:${provider}`);

    const cookies = await managed.context.cookies();
    this.contexts.delete(provider);
    await managed.context.close();
    return this.launch(provider, url, managed.userDataDirectory, mode, cookies);
  }

  private async launch(
    provider: string,
    url: string,
    userDataDirectory: string,
    mode: BrowserMode,
    cookies: Awaited<ReturnType<BrowserContext['cookies']>> = []
  ): Promise<Page> {
    let context: BrowserContext | null = null;
    try {
      context = await this.launcher.launchPersistentContext(userDataDirectory, {
        ...this.launchOptions,
        headless: mode === 'headless'
      });
      await context.addCookies(cookies);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      this.contexts.set(provider, {
        context,
        userDataDirectory
      });
      return page;
    } catch (error) {
      await context?.close().catch(() => undefined);
      throw error;
    }
  }

  private async dispose(provider: string): Promise<void> {
    const managed = this.contexts.get(provider);
    if (!managed) return;
    this.contexts.delete(provider);
    await managed.context.close();
  }
}
