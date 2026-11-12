export const isOfficeFile = (name) => /\.(?:docx|xlsx|pptx|doc|xls|ppt)$/i.test(name);

export class OfficeState {
  constructor(cap) {
    this.cap = cap;
    this.generation = 0;
    this.saveVersion = 0;
    this.collected = true;
    this.dirty = false;
    this.saving = false;
    this.remote = false;
  }
  changed(editing) {
    this.collected = !editing;
    if (editing) { this.generation++; this.dirty = true; }
  }
  beginSave() {
    if (!this.collected || this.saving) return false;
    this.pending = { generation: this.generation, saveVersion: this.saveVersion };
    this.saving = true;
    return true;
  }
  receive(session) {
    if (!this.session && session.resumed) this.dirty = true;
    this.session = session;
    const advanced = session.saveVersion > this.saveVersion;
    if (advanced) this.saveVersion = session.saveVersion;
    if (session.result) this.cap = session.result;
    if (this.remoteCap) this.remote = this.remoteCap.token !== this.cap.token;
    if (["conflict", "error"].includes(session.status)) {
      this.saving = false;
      this.dirty = true;
      this.pending = null;
      return;
    }
    const acknowledged = this.pending && (session.saveVersion > this.pending.saveVersion
      || (session.unchanged && session.result && session.saveVersion > 0));
    if (acknowledged) {
      this.dirty = this.generation !== this.pending.generation || !this.collected;
      this.saving = false;
      this.pending = null;
    } else if (session.unchanged) {
      this.saving = false;
      this.pending = null;
    }
  }
  markRemote(cap) {
    this.remoteCap = cap;
    this.remote = cap.token !== this.cap.token;
  }
  hasDirty() { return this.dirty || this.saving; }
}
