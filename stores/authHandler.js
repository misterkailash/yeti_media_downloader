import { useUiStore } from './ui';
import { useStoriesStore } from './stories';
import { useLoginStore } from './login';

// Shared 401 handler. Returns true if the caller should abort.
export async function handleIgAuth(res) {
  if (res.status !== 401) return false;
  const ui = useUiStore();
  const stories = useStoriesStore();
  const login = useLoginStore();
  const data = await res.clone().json().catch(() => ({}));
  if (data.loggedOut) {
    login.setLoggedIn(false);
    stories.hideAll();
    ui.showAuthWarn('Your Instagram session expired. Please log in again to view stories and highlights.', { showLogin: true });
    return true;
  }
  if (data.challengeRequired) {
    stories.hideAll();
    const url = data.challengeUrl || 'https://www.instagram.com/';
    ui.showAuthWarn('', {
      html: {
        prefix: 'Instagram wants to verify this login. Open ',
        link: { href: url, text: 'Instagram' },
        suffix: ', finish the "was this you?" / verification prompt, then reload this page.',
      },
    });
    return true;
  }
  return false;
}
