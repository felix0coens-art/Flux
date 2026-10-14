  // ---------- Staat bewaren ----------

  /** Na elke wijziging: herberekenen, bewaren, synchroniseren (niet in de voorbeeldmodus), tekenen. */
  function commit(msg) {
    C.recompute(state);
    if (demo) {
      Store.save(demo, Store.DEMO_KEY);
    } else {
      const changed = C.stampChanges(snap, realState);
      snap = C.snapshot(realState);
      if (!Store.save(realState)) toast('Opslaan mislukt — is de opslag van je browser vol?');
      if (Sync) Sync.noteChanges(changed);
    }
    if (msg) toast(msg);
    render();
  }

  /** Vervangt de echte gegevens (na synchronisatie). In de voorbeeldmodus blijft de zandbak zichtbaar. */
  function setState(newState, options) {
    realState = C.recompute(Store.migrate(JSON.parse(JSON.stringify(newState))));
    if (options && options.stampAll) {
      const changed = C.stampChanges(null, realState);
      if (Sync) Sync.noteChanges(changed);
    }
    snap = C.snapshot(realState);
    Store.save(realState);
    if (!demo) state = realState;
    if (!modal) render();
  }

  function enterDemo() {
    demo = Store.demoState(today);
    Store.save(demo, Store.DEMO_KEY);
    try { localStorage.setItem('flux-demo-active', '1'); } catch (e) { /* */ }
    state = demo;
    go('dashboard');
    toast('Voorbeeldmodus: verzonnen gegevens, volledig los van je eigen gegevens');
  }
  function exitDemo() {
    demo = null;
    Store.clear(Store.DEMO_KEY);
    try { localStorage.removeItem('flux-demo-active'); } catch (e) { /* */ }
    state = realState;
    go('dashboard');
    toast('Terug naar je eigen gegevens');
  }

