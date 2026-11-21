const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.promptEl = $('prompt');
    this.toastEl = $('toast');
    this.objList = $('obj-list');
    this.modal = $('modal');
    this.modalTitle = $('modal-title');
    this.modalBody = $('modal-body');
    this.progressEl = $('progress');
    this.toastTimer = 0;
    this.promptVisible = false;
    this.modalOpen = false;
    this.onModalClose = null;
    $('modal-close').addEventListener('click', () => this.closeModal());
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.closeModal(); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modalOpen) this.closeModal();
    });
  }

  prompt(text) {
    if (!text) return this.hidePrompt();
    this.promptEl.textContent = text;
    if (!this.promptVisible) {
      this.promptEl.classList.add('on');
      this.promptVisible = true;
    }
  }

  hidePrompt() {
    if (this.promptVisible) {
      this.promptEl.classList.remove('on');
      this.promptVisible = false;
    }
  }

  toast(text, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    this.toastTimer = ms / 1000;
  }

  setObjectives(items) {
    this.objList.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li');
      li.className = it.done ? 'done' : '';
      li.textContent = it.text;
      this.objList.appendChild(li);
    }
  }

  setProgress(n, total) {
    this.progressEl.textContent = `${n} / ${total}`;
  }

  openModal(title, body) {
    this.modalTitle.textContent = title;
    this.modalBody.innerHTML = body;
    this.modal.classList.add('on');
    this.modalOpen = true;
    this.hidePrompt();
  }

  closeModal() {
    if (!this.modalOpen) return;
    this.modal.classList.remove('on');
    this.modalOpen = false;
    if (this.onModalClose) this.onModalClose();
  }

  update(dt) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('on');
    }
  }
}
