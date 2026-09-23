export type PhotoStatus = 'illustrative' | 'real';

export interface Photo {
  src: string;
  alt: string;
  title: string;
  status: PhotoStatus;
}

export const photoStatusLabels: Record<PhotoStatus, string> = {
  illustrative: '示意图片',
  real: '真实照片',
};

export const photoStatusDescriptions: Record<PhotoStatus, string> = {
  illustrative: '这是用于预览版式的示意图片，之后可替换为真实照片。',
  real: '这是真实照片。',
};

export function getPhotoSummary(items: readonly Photo[]) {
  if (items.length === 0) return '照片待添加。';

  const counts = items.reduce((total, photo) => {
    total[photo.status] += 1;
    return total;
  }, { illustrative: 0, real: 0 });

  return `共 ${items.length} 张照片，其中${photoStatusLabels.illustrative} ${counts.illustrative} 张、${photoStatusLabels.real} ${counts.real} 张。`;
}

export const photos: Photo[] = [
  { src: '/images/sunlight.webp', alt: '阳光穿过绿叶', title: '树影里的光', status: 'illustrative' },
  { src: '/images/sea.webp', alt: '夕阳映在平静海面上', title: '落日与海', status: 'illustrative' },
  { src: '/images/flower.webp', alt: '窗边玻璃花瓶中的一枝花', title: '窗边的一枝花', status: 'illustrative' },
];
