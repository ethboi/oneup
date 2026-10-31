/**
 * A browser driven by automation (WebDriver, Playwright, Puppeteer) says so. Such sessions, like a reviewer's
 * scripted run, skip the power-on screen and the screens that open by themselves (round results, a jackpot
 * win), which would otherwise sit over whatever the script clicks next.
 */
export const automated = () => typeof navigator !== "undefined" && navigator.webdriver === true;
