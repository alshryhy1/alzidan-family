(function forceDelegateInitialView(){
  try {
    var params = new URLSearchParams(window.location.search || "");
    if (params.get("view") === "delegate") {
      var style = document.createElement("style");
      style.textContent = "#tree-card{display:none!important}";
      document.head.appendChild(style);
    }
  } catch(e) {}
})();
