/**
 * The site's confirmed words, carried over verbatim from the previous journal.
 * Only wording the two of them already approved lives here; nothing is invented.
 * Runtime status lines stay next to the code that shows them.
 */

export const site = {
  name: 'loveuhqq',
  title: '爱你，何青青。 · loveuhqq',
  description: '一本写给何青青的纸上手账。',
  skip: '跳到正文',
} as const;

export const homeNav = [
  { href: '#days', label: '日子' },
  { href: '#photos', label: '照片' },
  { href: '#note', label: '心里话' },
  { href: '#future', label: '往后' },
  { href: '#letter', label: '信' },
] as const;

export const hero = {
  lines: ['爱你，', '何青青。'],
  label: '爱你，何青青。',
  countLead: '今天，是我们在一起的',
  since: '始于',
  scroll: '往下翻',
} as const;

export const days = {
  title: ['一天，', '记一格。'],
  lede: (start: string) => `从 ${start} 开始，走过的日子都涂上了颜色。`,
  hint: '点一格，翻到那一天的背面。手机上可以左右轻扫，也可以用方向键翻看。',
  firstDay: '第一天',
  firstAnniversary: '一周年',
  prevYear: '上一年',
  nextYear: '下一年',
  jump: '翻看这天',
  today: '回到今天',
  legend: { past: '走过的日子', future: '还没到的日子', mark: '纪念日', moment: '有故事的日子' },
  filled: '已经涂了',
  cells: '格',
  yearTotal: '这一年共',
  next: '下一个纪念日',
  remaining: '还有',
  day: '天',
  moments: '记下的日子',
} as const;

export const photos = {
  title: '照片墙',
  lede: '纪念我们走过的每一天',
  locked: '照片只给我们俩看，解锁后才能翻看。',
  unlock: '解锁照片',
  noscript: '开启 JavaScript 并解锁后，才能看到照片。',
  pending: '待解锁',
  album: '翻开整本相册',
} as const;

export const note = {
  title: '心里话',
  lines: ['记录生活，', '慢慢往前走。'],
  sign: ['平平淡淡，', '踏实过好每一天。'],
} as const;

export const future = {
  title: ['往后的日子', '也想和你一起'],
  lede: ['想到一件就写下来。', '不用着急，一件一件来。'],
  draw: '从清单里抽一件',
  list: '往后的小清单',
  empty: '还空着',
} as const;

export const memoryChapters = [
  { id: 'stories', nav: '故事', title: '我们的故事', note: '把经历收成一页', lede: '写下我们共同走过的经历，双方可以留下各自的版本。', locked: '解锁后，才能翻开我们的故事。' },
  { id: 'wishes', nav: '往后', title: '往后与后来', note: '从想一起做，到一起做过', lede: '可以先商定日期，做过以后，再把故事收在旁边。', locked: '解锁后，翻看往后与后来的记录。' },
  { id: 'post-office', nav: '邮局', title: '未来邮局', note: '留到约好的日子', lede: '封好后不能改正文。拆信日期按北京时间计算，到日子再来翻开。', locked: '解锁后，才能翻开未来邮局的信件。' },
  { id: 'screening', nav: '放映', title: '回忆放映室', note: '慢慢翻，也可以放着看', lede: '选择故事与照片，按顺序排成一段回忆，慢慢翻，也可以放着看。', locked: '解锁后，开启回忆放映室。' },
  { id: 'places', nav: '地点', title: '地点备忘', note: '以后再慢慢记', lede: '先留一个地点名，想好后再关联故事或愿望。不用填写坐标。', locked: '解锁后，翻看地点备忘。' },
  { id: 'shared-desk', nav: '桌面', title: '共同桌面', note: '一起摆一摆', lede: '桌上摆着照片、便签和票根，两个人可以一起翻看和摆放。', locked: '解锁后，打开共同桌面。' },
] as const;

export const memoryBook = {
  eyebrow: '写下来，再一起翻看',
  title: '共同回忆册',
  lede: '日子、照片和往后的想法，都可以在这里接着写。',
  open: '翻开共同回忆册',
  contents: '回忆册目录',
  locked: '解锁后，才能翻开我们的回忆册。',
} as const;

export const letter = {
  title: ['写给第 ', '100', ' 天'],
  waiting: '待拆',
  ready: '可拆',
  readyCopy: '这封信可以拆开了。',
  guestCopy: '解锁共同手账后，才能读到信里的文字。',
  openCopy: '拆开信封，读这封写给第 100 天的信。',
  envelope: '一个封着蜡的信封',
  open: '拆开信封',
  close: '收好这封信',
  retry: '再试一次',
} as const;

export const footer = {
  words: ['往后。', '未完待续。'],
  lock: '上锁',
  top: '回到第一页',
} as const;

export const gate = {
  question: ['我们，', '是从哪天开始的？'],
  hint: '月和日，四位数字',
  month: '月',
  day: '日',
  fieldLabel: '月和日',
  otpLabel: '开始的日子，月和日共四位数字',
  passwordLabel: '共同手账的密码',
  unlock: '解锁手账',
  visit: '访客浏览',
  retryLogout: '重试退出',
} as const;

export const common = {
  unlock: '解锁手账',
  noscriptUnlock: '开启 JavaScript 后才能解锁。',
  backToJournal: '回到日记',
  guest: '访客',
  guestLabel: '访客，点击解锁共同手账',
  logout: '退出',
  ourJournal: '我们的手账',
  themeToLight: '切换为浅色',
  themeToDark: '切换为深色',
  pageNav: '页内导航',
} as const;

export const lost = {
  title: '这一页，好像被撕掉了。',
  lede: '地址可能写错了，回日记里看看吧。',
} as const;
