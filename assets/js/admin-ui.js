document.addEventListener("DOMContentLoaded", function () {
  function bindCollapse(section) {
    var header = section.querySelector(".section-header");
    if (!header || header.dataset.collapseBound === "1") return;
    header.dataset.collapseBound = "1";
    header.title = "اضغط لفتح أو إغلاق القسم";
    header.addEventListener("click", function (event) {
      if (event.target && ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A", "SUMMARY"].includes(event.target.tagName)) return;
      section.classList.toggle("is-collapsed");
    });
  }

  document.querySelectorAll(".maintenance-section, .extra-tools-section[data-maintenance='1']").forEach(function (section) {
    if (section.id === "bulk-name-audit-section") {
      section.classList.remove("is-collapsed");
    } else {
      section.classList.add("is-collapsed");
    }
    bindCollapse(section);
  });

  setTimeout(function () {
    var bulk = document.getElementById("bulk-name-audit-section");
    if (bulk) bulk.classList.remove("is-collapsed");
  }, 0);
});
