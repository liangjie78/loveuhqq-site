export interface DesktopItem {
  id: string; kind: 'story' | 'photo' | 'note' | 'ticket'; refId: string; text: string;
  x: number; y: number; rotation: number; version: number;
}
export interface DesktopSnapshot { revision: number; items: DesktopItem[]; current: { kind: 'story' | 'photo'; id: string; memberId: string } | null }
