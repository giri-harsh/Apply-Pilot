// Shared markup for the Greenhouse-style invisible-reCAPTCHA fixtures (index, visible-v2, escalates).
// Reproduces the structure of a real board page: badge, invisible anchor, 0x0 frames, response textarea, an intl-tel-input
// country control with a search box, a tel input, two file inputs and two custom questions. No network: frame sources are local.
(function () {
  var COUNTRIES = [["us", "United States", "1"], ["gb", "United Kingdom", "44"], ["in", "India", "91"], ["ca", "Canada", "1"], ["de", "Germany", "49"], ["fr", "France", "33"], ["au", "Australia", "61"], ["sg", "Singapore", "65"]];
  var root = document.getElementById("form-root");
  root.innerHTML =
    '<form id="app" onsubmit="return false">' +
    '<label for="first_name">First Name*</label><input id="first_name" name="first_name" type="text" required>' +
    '<label for="last_name">Last Name*</label><input id="last_name" name="last_name" type="text" required>' +
    '<label for="preferred_name">Preferred First Name</label><input id="preferred_name" name="preferred_name" type="text">' +
    '<label for="email">Email*</label><input id="email" name="email" type="email" required>' +
    '<div class="iti"><label id="country-label">Country</label>' +
    '<button type="button" class="iti__selected-country" id="country" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="country-label" title="Select a country">' +
    '<span class="iti__flag iti__xx"></span><span class="iti__selected-dial-code"></span></button>' +
    '<div class="iti__dropdown-content" id="iti-dropdown" hidden><input type="text" class="iti__search-input" id="iti-search" placeholder="Search" aria-label="Search countries">' +
    '<ul class="iti__country-list" id="iti-list" role="listbox" aria-label="List of countries"></ul></div></div>' +
    '<label for="phone">Phone</label><input id="phone" name="phone" type="tel">' +
    '<label for="resume">Resume/CV*</label><input id="resume" name="resume" type="file" accept=".pdf,.doc,.docx" required>' +
    '<label for="cover_letter">Cover Letter</label><input id="cover_letter" name="cover_letter" type="file" accept=".pdf,.doc,.docx">' +
    '<label for="question_69658288">LinkedIn Profile</label><input id="question_69658288" name="question_69658288" type="text">' +
    '<label for="question_69658289">Internal Mobility Policy Acknowledgement*</label>' +
    '<input id="question_69658289" name="question_69658289" type="text" required placeholder="Type I acknowledge">' +
    '<button type="button" id="submit" class="btn">Submit application</button></form>';

  // intl-tel-input behaviour: open, filter by the search box, pick, and show the flag + dial code (title carries "India: +91").
  var btn = document.getElementById("country"), dd = document.getElementById("iti-dropdown"), list = document.getElementById("iti-list"), search = document.getElementById("iti-search");
  COUNTRIES.forEach(function (c) {
    var li = document.createElement("li");
    li.className = "iti__country";
    li.setAttribute("role", "option");
    li.setAttribute("data-country-code", c[0]);
    li.setAttribute("data-dial-code", c[2]);
    li.innerHTML = '<span class="iti__flag iti__' + c[0] + '"></span><span class="iti__country-name">' + c[1] + '</span><span class="iti__dial-code">+' + c[2] + "</span>";
    li.addEventListener("click", function () {
      btn.querySelector(".iti__flag").className = "iti__flag iti__" + c[0];
      btn.querySelector(".iti__selected-dial-code").textContent = "+" + c[2];
      btn.title = c[1] + ": +" + c[2];
      btn.setAttribute("aria-expanded", "false");
      dd.hidden = true;
      window.__country = c[0];
    });
    list.appendChild(li);
  });
  btn.addEventListener("click", function () {
    var open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    dd.hidden = !open;
    if (open) search.focus();
  });
  search.addEventListener("input", function () {
    var q = search.value.trim().toLowerCase();
    Array.prototype.forEach.call(list.children, function (li) { li.hidden = q !== "" && li.textContent.toLowerCase().indexOf(q) < 0; });
  });
})();
