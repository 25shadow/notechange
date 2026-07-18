import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

type BrowserCookies = Awaited<ReturnType<BrowserContext['cookies']>>;

type StoredSession = {
  version: 1;
  cookies: BrowserCookies;
};

const sessionFileName = 'notechange-session.json';

export class SessionManager {
  private readonly contexts = new Map<string, ManagedContext>();
  private readonly pendingOpens = new Map<string, Promise<Page>>();

  constructor(
    private readonly launchOptions: PersistentContextOptions = { headless: false },
    private readonly rootDirectory = join(tmpdir(), 'notechange-browser'),
    private readonly launcher: PersistentContextLauncher = chromium
  ) {}

  async open(provider: string, url: string, mode: BrowserMode = 'headed'): Promise<Page> {
    const pending = this.pendingOpens.get(provider);
    if (pending) return pending;

    const opening = this.openNewContext(provider, url, mode);
    this.pendingOpens.set(provider, opening);
    try {
      return await opening;
    } finally {
      if (this.pendingOpens.get(provider) === opening) this.pendingOpens.delete(provider);
    }
  }

  private async openNewContext(
    provider: string,
    url: string,
    mode: BrowserMode
  ): Promise<Page> {
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

  async persist(provider: string): Promise<void> {
    const managed = this.contexts.get(provider);
    if (!managed) throw new Error(`LOGIN_SESSION_MISSING:${provider}`);
    await this.saveCookies(managed.userDataDirectory, await managed.context.cookies());
  }

  async switchToHeadless(provider: string, url: string): Promise<Page> {
    return this.switchMode(provider, url, 'headless');
  }

  async switchToHeaded(provider: string, url: string): Promise<Page> {
    return this.switchMode(provider, url, 'headed');
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled([...this.pendingOpens.values()]);
    await Promise.all([...this.contexts.keys()].map((provider) => this.dispose(provider)));
  }

  async logout(provider: string): Promise<void> {
    const managed = this.contexts.get(provider);
    if (managed) {
      this.contexts.delete(provider);
      await managed.context.clearCookies();
      await managed.context.close();
      await rm(join(managed.userDataDirectory, sessionFileName), { force: true });
      return;
    }
    const safeProvider = provider.replace(/[^a-z0-9_-]/gi, '_');
    await rm(join(this.rootDirectory, safeProvider, sessionFileName), { force: true });
  }

  private async switchMode(provider: string, url: string, mode: BrowserMode): Promise<Page> {
    const managed = this.contexts.get(provider);
    if (!managed) throw new Error(`LOGIN_SESSION_MISSING:${provider}`);

    const cookies = await managed.context.cookies();
    await this.saveCookies(managed.userDataDirectory, cookies);
    this.contexts.delete(provider);
    await managed.context.close();
    return this.launch(provider, url, managed.userDataDirectory, mode, cookies);
  }

  private async launch(
    provider: string,
    url: string,
    userDataDirectory: string,
    mode: BrowserMode,
    cookies?: BrowserCookies
  ): Promise<Page> {
    let context: BrowserContext | null = null;
    try {
      context = await this.launcher.launchPersistentContext(userDataDirectory, {
        ...this.launchOptions,
        headless: mode === 'headless'
      });
      await context.addCookies(cookies ?? (await this.loadCookies(userDataDirectory)));
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
    try {
      await this.saveCookies(managed.userDataDirectory, await managed.context.cookies());
    } finally {
      await managed.context.close();
    }
  }

  private async loadCookies(userDataDirectory: string): Promise<BrowserCookies> {
    try {
      const stored = JSON.parse(
        await readFile(join(userDataDirectory, sessionFileName), 'utf8')
      ) as Partial<StoredSession>;
      return stored.version === 1 && Array.isArray(stored.cookies) ? stored.cookies : [];
    } catch {
      return [];
    }
  }

  private async saveCookies(
    userDataDirectory: string,
    cookies: BrowserCookies
  ): Promise<void> {
    const sessionFile = join(userDataDirectory, sessionFileName);
    const temporaryFile = `${sessionFile}.${process.pid}.tmp`;
    const stored: StoredSession = { version: 1, cookies };
    await writeFile(temporaryFile, JSON.stringify(stored), {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporaryFile, sessionFile);
  }
}
