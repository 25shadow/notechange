import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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

export class SessionManager {
  private readonly contexts = new Map<string, ManagedContext>();

  constructor(
    private readonly launchOptions: PersistentContextOptions = { headless: false },
    private readonly rootDirectory = join(tmpdir(), 'notechange-browser'),
    private readonly launcher: PersistentContextLauncher = chromium
  ) {}

  async open(provider: string, url: string): Promise<Page> {
    await this.dispose(provider);
    await mkdir(this.rootDirectory, { recursive: true });
    const safeProvider = provider.replace(/[^a-z0-9_-]/gi, '_');
    const userDataDirectory = await mkdtemp(join(this.rootDirectory, `${safeProvider}-`));

    try {
      const context = await this.launcher.launchPersistentContext(
        userDataDirectory,
        this.launchOptions
      );
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      this.contexts.set(provider, {
        context,
        userDataDirectory
      });
      return page;
    } catch (error) {
      await rm(userDataDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  getPage(provider: string): Page | null {
    const managed = this.contexts.get(provider);
    if (!managed) return null;
    return managed.context.pages()[0] ?? null;
  }

  async switchToHeadless(provider: string, url: string): Promise<Page> {
    const managed = this.contexts.get(provider);
    if (!managed) throw new Error(`LOGIN_SESSION_MISSING:${provider}`);

    const cookies = await managed.context.cookies();
    this.contexts.delete(provider);
    await managed.context.close();

    try {
      const context = await this.launcher.launchPersistentContext(managed.userDataDirectory, {
        ...this.launchOptions,
        headless: true
      });
      await context.addCookies(cookies);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      this.contexts.set(provider, {
        context,
        userDataDirectory: managed.userDataDirectory
      });
      return page;
    } catch (error) {
      await rm(managed.userDataDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.contexts.keys()].map((provider) => this.dispose(provider)));
  }

  private async dispose(provider: string): Promise<void> {
    const managed = this.contexts.get(provider);
    if (!managed) return;
    this.contexts.delete(provider);
    await managed.context.close();
    await rm(managed.userDataDirectory, { recursive: true, force: true });
  }
}
