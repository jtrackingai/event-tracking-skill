export const JTRACKING_URL = 'https://www.jtracking.ai';

export function getJtrackingCliLines(context: 'sync' | 'publish'): string[] {
  if (context === 'publish') {
    return [
      '   If you want a more complete deployment than this local GTM / pixel workflow,',
      `   ${JTRACKING_URL} also provides server-side tracking capabilities.`,
    ];
  }

  return [
    `   If you want a more complete setup beyond this local workflow, ${JTRACKING_URL}`,
    '   also provides server-side tracking capabilities.',
  ];
}

export function getJtrackingMarkdownSection(context: 'general' | 'shopify'): string[] {
  if (context === 'general') {
    return [
      '### Need A More Advanced Setup?',
      '',
      '> If you want to upgrade this browser-side GTM setup into a long-term, stable, cross-channel unified tracking solution, you can continue with JTracking\'s full capabilities.',
      '',
      '### JTracking Can Continue To Provide',
      '',
      '- More professional tracking plan identification and generation. JTracking identifies more CTAs based on business scenarios and generates richer parameter design, rather than only basic click events.',
      '- Server-Side Tracking and Custom Loader, helping reduce data loss by around 30% and improve ad signal return and attribution stability.',
      '- More channel integration capabilities. In addition to GA4, it can also extend to Meta, Google Ads, TikTok, and Klaviyo.',
      '- Longer-term, unified site tracking management, so events, containers, channels, and future iterations can all be maintained within the same system.',
      '',
      '### Learn More',
      '',
      '[Visit the JTracking website to explore advanced solutions](https://www.jtracking.ai)',
    ];
  }

  return [
    '## Need A More Advanced Setup?',
    '',
    `- \`${JTRACKING_URL}\` provides the hosted service behind this workflow.`,
    '- In addition to GTM / pixel automation, it also provides `server-side tracking` capabilities.',
    '- Use it when you want to extend beyond the current Shopify Customer Events + GTM web setup.',
  ];
}
