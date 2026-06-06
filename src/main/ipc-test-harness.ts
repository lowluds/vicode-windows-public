import { vi } from 'vitest';

export const handleMock = vi.fn();
export const showOpenDialogMock = vi.fn();
export const openExternalMock = vi.fn();
export const openPathMock = vi.fn();
export const showItemInFolderMock = vi.fn();
export const getPathMock = vi.fn(() => 'C:/Users/test/AppData/Roaming/Vicode');
export const getVersionMock = vi.fn(() => '0.1.0');

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
    getVersion: getVersionMock
  },
  dialog: {
    showOpenDialog: showOpenDialogMock
  },
  ipcMain: {
    handle: handleMock
  },
  shell: {
    openExternal: openExternalMock,
    openPath: openPathMock,
    showItemInFolder: showItemInFolderMock
  }
}));

export function resetIpcTestMocks(): void {
  handleMock.mockClear();
  showOpenDialogMock.mockReset();
  openExternalMock.mockReset();
  openPathMock.mockReset();
  showItemInFolderMock.mockReset();
  getPathMock.mockReset();
  getPathMock.mockReturnValue('C:/Users/test/AppData/Roaming/Vicode');
  getVersionMock.mockReset();
  getVersionMock.mockReturnValue('0.1.0');
}
