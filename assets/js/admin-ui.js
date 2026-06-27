document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".maintenance-section").forEach(function (section) {
    section.classList.add("is-collapsed");
    var header = section.querySelector(".section-header");
    if (!header) return;
    header.title = "اضغط لفتح أو إغلاق أدوات الصيانة";
    header.addEventListener("click", function (event) {
      if (event.target && ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].includes(event.target.tagName)) return;
      section.classList.toggle("is-collapsed");
    });
  });
});

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".extra-tools-section[data-maintenance=\"1\"]").forEach(function (section) {
    section.classList.add("is-collapsed");
    var header = section.querySelector(".section-header");
    if (!header) return;
    header.title = "اضغط لفتح أو إغلاق الأدوات الإضافية";
    header.addEventListener("click", function (event) {
      if (event.target && ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A", "SUMMARY"].includes(event.target.tagName)) return;
      section.classList.toggle("is-collapsed");
    });
  });
});
