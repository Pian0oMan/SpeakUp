// START: runs last, after every other file has loaded.

updateMyButtons(); // draw the (crossed-out) mic and camera icons
start(); // run when the page opens

// Makes Speak Up installable as an app (see static/sw.js)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
