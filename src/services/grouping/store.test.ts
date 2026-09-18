import { describe, it, expect, beforeEach } from 'vitest';
import { loadUndo, saveUndo, clearUndo } from './store';

describe('grouping undo store (localStorage path)', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips and clears', async () => {
    expect(await loadUndo()).toBeNull();
    await saveUndo({ at: 't', moved: [{ id: 'a', fromParentId: 'bar' }], createdFolderIds: ['f'] });
    expect(await loadUndo()).toEqual({ at: 't', moved: [{ id: 'a', fromParentId: 'bar' }], createdFolderIds: ['f'] });
    await clearUndo();
    expect(await loadUndo()).toBeNull();
  });
});
