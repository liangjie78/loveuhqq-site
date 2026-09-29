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

/** One spoken form for every polaroid link, in the templates and the lightbox. */
export function photoAriaLabel(photo: Photo) {
  return `${photo.title}（${photoStatusLabels[photo.status]}），查看大图`;
}

export function getPhotoSummary(items: readonly Photo[]) {
  if (items.length === 0) return '还没有照片。';

  const real = items.filter((photo) => photo.status === 'real').length;
  const illustrative = items.length - real;

  if (real === 0) return `这 ${illustrative} 张都是示意图，我们的照片会一张张换上来。`;
  if (illustrative === 0) return `${real} 张照片。`;
  return `${real} 张我们的照片，${illustrative} 张示意图。`;
}

export const photos: Photo[] = [
  { src: '/images/sunlight.webp', alt: '阳光穿过绿叶', title: '树影里的光', status: 'illustrative' },
  { src: '/images/sea.webp', alt: '夕阳映在平静海面上', title: '落日与海', status: 'illustrative' },
  { src: '/images/flower.webp', alt: '窗边玻璃花瓶中的一枝花', title: '窗边的一枝花', status: 'illustrative' },
];
