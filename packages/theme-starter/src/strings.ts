/** Interface strings of the starter theme. Content is never translated; only the theme's own labels. */
export interface ThemeStrings {
  skipToContent: string;
  mainNavigation: string;
  footerNavigation: string;
  home: string;
  latestPosts: string;
  readMore: string;
  publishedOn: string;
  by: string;
  minutesRead: (minutes: number) => string;
  pagination: string;
  previous: string;
  next: string;
  pageOf: (page: number, total: number) => string;
  notFoundTitle: string;
  notFoundText: string;
  backHome: string;
  noEntries: string;
  details: string;
  preview: string;
  poweredBy: string;
}

const en: ThemeStrings = {
  skipToContent: 'Skip to content',
  mainNavigation: 'Main',
  footerNavigation: 'Footer',
  home: 'Home',
  latestPosts: 'Latest posts',
  readMore: 'Read more',
  publishedOn: 'Published',
  by: 'by',
  minutesRead: (minutes) => `${String(minutes)} min read`,
  pagination: 'Pagination',
  previous: 'Newer',
  next: 'Older',
  pageOf: (page, total) => `Page ${String(page)} of ${String(total)}`,
  notFoundTitle: 'Page not found',
  notFoundText: 'The page you are looking for does not exist or has moved.',
  backHome: 'Go to the home page',
  noEntries: 'Nothing has been published here yet.',
  details: 'Details',
  preview:
    'Preview: this is how the latest saved version looks. It is not public and this link expires.',
  poweredBy: 'Powered by NEXORA',
};

const fa: ThemeStrings = {
  skipToContent: 'رفتن به محتوا',
  mainNavigation: 'اصلی',
  footerNavigation: 'پانویس',
  home: 'خانه',
  latestPosts: 'تازه‌ترین نوشته‌ها',
  readMore: 'ادامه مطلب',
  publishedOn: 'منتشرشده',
  by: 'توسط',
  minutesRead: (minutes) => `${minutes.toLocaleString('fa')} دقیقه مطالعه`,
  pagination: 'صفحه‌بندی',
  previous: 'جدیدتر',
  next: 'قدیمی‌تر',
  pageOf: (page, total) => `صفحه ${page.toLocaleString('fa')} از ${total.toLocaleString('fa')}`,
  notFoundTitle: 'صفحه پیدا نشد',
  notFoundText: 'صفحه‌ای که دنبالش هستید وجود ندارد یا جابه‌جا شده است.',
  backHome: 'رفتن به صفحه اصلی',
  noEntries: 'هنوز چیزی اینجا منتشر نشده است.',
  details: 'جزئیات',
  preview:
    'پیش‌نمایش: آخرین نسخه ذخیره‌شده این‌گونه دیده می‌شود. این صفحه عمومی نیست و پیوند آن منقضی می‌شود.',
  poweredBy: 'قدرت‌گرفته از NEXORA',
};

const TABLE: Record<string, ThemeStrings> = { en, fa };

export function stringsFor(language: string): ThemeStrings {
  return TABLE[language.split('-')[0]?.toLowerCase() ?? 'en'] ?? en;
}
