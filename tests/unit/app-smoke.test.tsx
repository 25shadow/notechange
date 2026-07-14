import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../../src/renderer/App';

describe('App', () => {
  it('直接显示迁移工作区', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '笔记迁移' })).toBeTruthy();
  });
});
