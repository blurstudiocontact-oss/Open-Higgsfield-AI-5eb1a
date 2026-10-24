import './style.css';
import { Header } from './components/Header.js';
import { ImageStudio } from './components/ImageStudio.js';

const app = document.querySelector('#app');
let contentArea;

// Router
function navigate(page) {
  if (!contentArea) return;
  // Pages holding live resources (streams, workers) release them on exit.
  Array.from(contentArea.children).forEach(child => child._cleanup?.());
  contentArea.innerHTML = '';

  if (page === 'reels') {
    import('./components/ReelStudio.js').then(({ ReelStudio }) => {
      contentArea.appendChild(ReelStudio());
    });
  } else if (page === 'image') {
    contentArea.appendChild(ImageStudio());
  } else if (page === 'video') {
    import('./components/VideoStudio.js').then(({ VideoStudio }) => {
      contentArea.appendChild(VideoStudio());
    });
  } else if (page === 'cinema') {
    import('./components/CinemaStudio.js').then(({ CinemaStudio }) => {
      contentArea.appendChild(CinemaStudio());
    });
  } else if (page === 'creative') {
    import('./components/CreativeStudio.js').then(({ CreativeStudio }) => {
      contentArea.appendChild(CreativeStudio());
    });
  } else if (page === 'obs') {
    import('./components/ObsStudio.js').then(({ ObsStudio }) => {
      contentArea.appendChild(ObsStudio());
    });
  }
}

app.innerHTML = '';
// Pass navigate to Header so links work
app.appendChild(Header(navigate));

contentArea = document.createElement('main');
contentArea.id = 'content-area';
contentArea.className = 'flex-1 relative w-full overflow-hidden flex flex-col bg-app-bg';
app.appendChild(contentArea);

// Initial Route
navigate('reels');

// Event Listener for Navigation
window.addEventListener('navigate', (e) => {
  if (e.detail.page === 'settings') {
    import('./components/SettingsModal.js').then(({ SettingsModal }) => {
      document.body.appendChild(SettingsModal());
    });
  } else {
    navigate(e.detail.page);
  }
});
