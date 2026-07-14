import type { Page } from 'playwright';

export type SameOriginRequest = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
};

export async function runSameOrigin<T>(
  page: Page,
  path: string,
  init: SameOriginRequest
): Promise<T> {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        ...requestInit,
        credentials: 'include'
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return response.json() as Promise<T>;
    },
    { requestPath: path, requestInit: init }
  );
}
