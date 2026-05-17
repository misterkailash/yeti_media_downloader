// Shared User-Agent strings. Kept version-specific because individual
// scrapers were written against the UA they expected — collapsing to one
// modern UA risks breaking sites that fingerprint on these exact strings.
const UA_DESKTOP_120 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_DESKTOP_120_LITE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const UA_DESKTOP_121 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const UA_DESKTOP_124 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_DESKTOP_124_LITE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
const UA_MOBILE_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const UA_INSTAGRAM_ANDROID = 'Instagram 309.0.0.40.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 542701491)';

module.exports = {
  UA_DESKTOP_120,
  UA_DESKTOP_120_LITE,
  UA_DESKTOP_121,
  UA_DESKTOP_124,
  UA_DESKTOP_124_LITE,
  UA_MOBILE_IPHONE,
  UA_INSTAGRAM_ANDROID,
};
