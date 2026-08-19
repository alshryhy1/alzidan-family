#!/usr/bin/env node
/**
 * Web person-card kinship matches the mobile encounter labels.
 * Run: node scripts/test-person-kinship.js
 */
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Kinship = require(path.join(__dirname, "../assets/js/modules/person-kinship.js"));

const grandfather = {
  id: 1,
  branchKey: "خزيم",
  parentName: "ملقاط",
  name: "ملقاط/خزيم",
  gender: "son",
};
const mother = {
  id: 2,
  branchKey: "خزيم",
  parentName: "ملقاط/خزيم",
  name: "ملقاط/خزيم/عقيله",
  gender: "daughter",
};
const khal = {
  id: 3,
  branchKey: "خزيم",
  parentName: "ملقاط/خزيم",
  name: "ملقاط/خزيم/سعد",
  gender: "son",
};
const aunt = {
  id: 4,
  branchKey: "خزيم",
  parentName: "ملقاط/خزيم",
  name: "ملقاط/خزيم/نوره",
  gender: "daughter",
};
const father = {
  id: 10,
  branchKey: "مزيد",
  parentName: "مزيد/خميس",
  name: "مزيد/خميس/عيد",
  gender: "son",
};
const viewer = {
  id: 11,
  branchKey: "مزيد",
  parentName: "مزيد/خميس/عيد",
  name: "مزيد/خميس/عيد/حسن",
  gender: "son",
};
const ibnKhal = {
  id: 20,
  branchKey: "خزيم",
  parentName: "ملقاط/خزيم/سعد",
  name: "ملقاط/خزيم/سعد/فهد",
  gender: "son",
};
const auntHusband = {
  id: 30,
  branchKey: "لاحم",
  parentName: "لاحم/عيد",
  name: "لاحم/عيد/محمد",
  gender: "son",
};
const ibnKhala = {
  id: 31,
  branchKey: "لاحم",
  parentName: "لاحم/عيد/محمد",
  name: "لاحم/عيد/محمد/ناصر",
  gender: "son",
};
const stranger = {
  id: 99,
  branchKey: "زيدان",
  parentName: "زيدان/مطلق",
  name: "زيدان/مطلق/فلان",
  gender: "son",
};

const ctx = {
  children: [grandfather, mother, khal, aunt, father, viewer, ibnKhal, auntHusband, ibnKhala, stranger],
  spouses: [
    {
      id: 100,
      husbandId: 10,
      wifeName: "عقيله",
      wifeLineage: "ملقاط/خزيم/عقيله",
      wifeIsFamilyMember: true,
      wifeBranchKey: "خزيم",
      status: "active",
    },
    {
      id: 200,
      husbandId: 30,
      wifeName: "نوره",
      wifeLineage: "ملقاط/خزيم/نوره",
      wifeIsFamilyMember: true,
      wifeBranchKey: "خزيم",
      status: "active",
    },
  ],
  motherLinks: [
    { childId: 11, spouseId: 100, confidence: "confirmed" },
    { childId: 31, spouseId: 200, confidence: "confirmed" },
  ],
};

assert.equal(Kinship.resolveMaternalKinshipLabel(11, 1, ctx), "جدك من الأم");
assert.equal(Kinship.resolveMaternalKinshipLabel(11, 3, ctx), "خالك");
assert.equal(Kinship.resolveMaternalKinshipLabel(11, 20, ctx), "ابن خالك");
assert.equal(Kinship.resolveMaternalKinshipLabel(11, 31, ctx), "ابن خالتك");
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, father), "أبوك");
const paternalGf = {
  id: 9,
  branchKey: "مزيد",
  parentName: "مزيد",
  name: "مزيد/خميس",
  gender: "son",
};
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, paternalGf), "جدك من الأب");
assert.equal(Kinship.resolveProvenKinshipLabel(paternalGf, viewer), "حفيدك");
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, grandfather, "جدك من الأم"), "جدك من الأم");
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, { id: 12, parentName: "مزيد/خميس/عيد", name: "مزيد/خميس/عيد/سعد" }), "أخ");
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, khal, "خالك"), "خالك");

const khuzaym = "زيدان بن مطلق بن زيدان/قرينيس/مشعان/ملقاط/خزيم";
const liveNasab = {
  children: [
    {
      id: 850,
      branchKey: "زيدان",
      parentName: "زيدان بن مطلق بن زيدان/قرينيس/مشعان/ملقاط",
      name: khuzaym,
      gender: null,
    },
    {
      id: 859,
      branchKey: "زيدان",
      parentName: khuzaym,
      name: khuzaym + "/سالم",
      gender: null,
    },
    {
      id: 1852,
      branchKey: "زيدان",
      parentName: khuzaym,
      name: khuzaym + "/عقيله",
      gender: "daughter",
    },
    {
      id: 120,
      branchKey: "مزيد",
      parentName: "مزيد بن مطلق بن زيدان/خميس/دليميك/خميس",
      name: "مزيد بن مطلق بن زيدان/خميس/دليميك/خميس/حسن",
      gender: null,
    },
  ],
  spouses: [
    {
      id: 1,
      husbandId: 116,
      wifeName: "عقيلة بنت خزيم بن ملقاط بن مشعان بن قرينيس بن زيدان بن مطلق",
      wifeLineage: "عقيلة بنت خزيم بن ملقاط بن مشعان بن قرينيس بن زيدان بن مطلق",
      wifeIsFamilyMember: true,
      wifeBranchKey: "زيدان",
      status: "active",
    },
  ],
  motherLinks: [{ childId: 120, spouseId: 1, confidence: "confirmed" }],
};

assert.equal(Kinship.resolveMaternalKinshipLabel(120, 850, liveNasab), "جدك من الأم");
assert.equal(Kinship.resolveMaternalKinshipLabel(120, 859, liveNasab), "خالك");

const hasan = liveNasab.children[3];
const dlymik = {
  id: 50,
  branchKey: "مزيد",
  parentName: "مزيد بن مطلق بن زيدان/خميس",
  name: "مزيد بن مطلق بن زيدان/خميس/دليميك",
};
assert.equal(Kinship.resolveProvenKinshipLabel(hasan, dlymik), "جدك من الأب");

const byId = { 859: "خالك", 850: "جدك من الأم" };
const byPath = {};
liveNasab.children.forEach(function (row) {
  if (!byId[row.id]) return;
  var path = Kinship.nodePathId({ name: row.name, parentName: row.parentName });
  if (path) byPath[path] = byId[row.id];
});
Kinship.setMemberState(hasan, byId, byPath, liveNasab.children, null, true);
assert.equal(
  Kinship.encounterForCard({
    nodeId: khuzaym,
    branchKey: "زيدان",
    rows: [],
  }).kinship,
  "جدك من الأم",
  "جد الأم يظهر حتى بدون صفوف الفرع",
);
assert.equal(
  Kinship.encounterForCard({
    nodeId: khuzaym + "/سالم",
    branchKey: "زيدان",
    rows: [],
  }).kinship,
  "خالك",
);
assert.equal(
  Kinship.encounterForCard({
    nodeId: hasan.name,
    branchKey: "مزيد",
    rows: liveNasab.children,
  }).mode,
  "self",
);

// Sibling kinship must work when tree rows only carry full path in name (no parent_name).
Kinship.setMemberState(hasan, {}, {}, liveNasab.children, liveNasab, true);
assert.equal(
  Kinship.encounterForCard({
    nodeId: "مزيد بن مطلق بن زيدان/خميس/دليميك/خميس/مزيد",
    branchKey: "مزيد",
    rows: [{ name: "مزيد بن مطلق بن زيدان/خميس/دليميك/خميس/مزيد" }],
  }).kinship,
  "أخ",
  "الأخ من نفس الأب يظهر دون افتراض أنه أخ لأب فقط",
);

// Maternal half-sibling via shared mother identity across different spouse rows.
const crossSpouseMaternalCtx = {
  children: [
    hasan,
    {
      id: 121,
      branchKey: "مزيد",
      parentName: "مزيد بن مطلق بن زيدان/خميس/دليميك/منصور",
      name: "مزيد بن مطلق بن زيدان/خميس/دليميك/منصور/فلان",
      gender: null,
    },
  ],
  spouses: [
    liveNasab.spouses[0],
    {
      id: 2,
      husbandId: 999,
      wifeName: "عقيلة بنت خزيم بن ملقاط بن مشعان بن قرينيس بن زيدان بن مطلق",
      wifeLineage: "عقيلة بنت خزيم بن ملقاط بن مشعان بن قرينيس بن زيدان بن مطلق",
      wifeIsFamilyMember: true,
      wifeBranchKey: "زيدان",
      status: "active",
    },
  ],
  motherLinks: [
    { childId: 120, spouseId: 1, confidence: "confirmed" },
    { childId: 121, spouseId: 2, confidence: "confirmed" },
  ],
};
const crossMap = Kinship.mapFromRelativeSets(
  Kinship.maternalRelativesForViewer(120, crossSpouseMaternalCtx),
);
assert.equal(crossMap[121], "أخ من أمك", "أخ من الأم عبر spouse_id مختلف");

// Maternal half-sibling via shared mother link (same spouse_id, different fathers).
const maternalSibCtx = {
  children: [
    hasan,
    {
      id: 121,
      branchKey: "مزيد",
      parentName: "مزيد بن مطلق بن زيدان/خميس/دليميك/منصور",
      name: "مزيد بن مطلق بن زيدان/خميس/دليميك/منصور/فلان",
      gender: null,
    },
  ],
  spouses: liveNasab.spouses,
  motherLinks: [
    { childId: 120, spouseId: 1, confidence: "confirmed" },
    { childId: 121, spouseId: 1, confidence: "confirmed" },
  ],
};
const maternalMap = Kinship.mapFromRelativeSets(
  Kinship.maternalRelativesForViewer(120, maternalSibCtx),
);
Kinship.setMemberState(hasan, maternalMap, {}, maternalSibCtx.children, maternalSibCtx, true);
assert.equal(
  Kinship.encounterForCard({
    nodeId: maternalSibCtx.children[1].name,
    branchKey: "مزيد",
    rows: [{ name: maternalSibCtx.children[1].name }],
  }).kinship,
  "أخ من أمك",
);

const fullBrother = {
  id: 13,
  branchKey: "مزيد",
  parentName: viewer.parentName,
  name: viewer.parentName + "/سعد",
  gender: "son",
};
const fullCtx = {
  children: [viewer, fullBrother],
  spouses: ctx.spouses,
  motherLinks: [
    { childId: 11, spouseId: 100, confidence: "confirmed" },
    { childId: 13, spouseId: 100, confidence: "confirmed" },
  ],
};
assert.equal(Kinship.siblingBondKind(viewer, fullBrother, fullCtx), "full");
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, fullBrother, null, fullCtx), "شقيقك");
assert.equal(
  Kinship.mapFromRelativeSets(Kinship.maternalRelativesForViewer(11, fullCtx))[13],
  undefined,
  "الشقيق لا يُوسم أخاً من الأم",
);

const paternalHalf = {
  id: 14,
  branchKey: "مزيد",
  parentName: viewer.parentName,
  name: viewer.parentName + "/فهد",
  gender: "son",
};
const paternalHalfCtx = {
  children: [viewer, paternalHalf],
  spouses: [
    ctx.spouses[0],
    {
      id: 300,
      husbandId: 10,
      wifeName: "نوره بنت سعد بن ملقاط",
      wifeLineage: "ملقاط/خزيم/نوره",
      wifeIsFamilyMember: true,
      wifeBranchKey: "خزيم",
      status: "active",
    },
  ],
  motherLinks: [
    { childId: 11, spouseId: 100, confidence: "confirmed" },
    { childId: 14, spouseId: 300, confidence: "confirmed" },
  ],
};
assert.equal(Kinship.siblingBondKind(viewer, paternalHalf, paternalHalfCtx), "paternal");
assert.equal(
  Kinship.resolveProvenKinshipLabel(viewer, paternalHalf, null, paternalHalfCtx),
  "أخ من الأب",
);

const falseNameCtx = {
  children: [
    viewer,
    {
      id: 15,
      branchKey: "لاحم",
      parentName: "لاحم/عيد",
      name: "لاحم/عيد/خالد",
      gender: "son",
    },
  ],
  spouses: [
    { id: 400, husbandId: 10, wifeName: "نوره", wifeLineage: "", wifeIsFamilyMember: true, status: "active" },
    { id: 401, husbandId: 30, wifeName: "نوال", wifeLineage: "", wifeIsFamilyMember: true, status: "active" },
  ],
  motherLinks: [
    { childId: 11, spouseId: 400, confidence: "confirmed" },
    { childId: 15, spouseId: 401, confidence: "confirmed" },
  ],
};
assert.equal(
  Kinship.resolveMaternalKinshipLabel(11, 15, falseNameCtx),
  null,
  "لا تُفترض الأم من تشابه الاسم الأول",
);

const brother = {
  id: 16,
  branchKey: "مزيد",
  parentName: viewer.parentName,
  name: viewer.parentName + "/سعد",
  gender: "son",
};
const nephew = {
  id: 17,
  branchKey: "مزيد",
  parentName: brother.name,
  name: brother.name + "/فهد",
  gender: "son",
};
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, nephew), "ابن أخيك");

const son = {
  id: 18,
  branchKey: "مزيد",
  parentName: viewer.name,
  name: viewer.name + "/خالد",
  gender: "son",
};
const grandson = {
  id: 19,
  branchKey: "مزيد",
  parentName: son.name,
  name: son.name + "/ناصر",
  gender: "son",
};
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, son), "ابنك");
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, grandson), "حفيدك");

const uncle = {
  id: 8,
  branchKey: "مزيد",
  parentName: "مزيد/خميس",
  name: "مزيد/خميس/سعد",
  gender: "son",
};
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, uncle), "عمك");
const cousin = {
  id: 81,
  branchKey: "مزيد",
  parentName: uncle.name,
  name: uncle.name + "/فهد",
  gender: "son",
};
assert.equal(Kinship.resolveProvenKinshipLabel(viewer, cousin), "ابن عمك");

const daughterViewer = {
  id: 70,
  branchKey: "مزيد",
  parentName: viewer.parentName,
  name: viewer.parentName + "/نوره",
  gender: "daughter",
};
assert.equal(Kinship.resolveProvenKinshipLabel(daughterViewer, father), "أبوك");
assert.equal(Kinship.resolveProvenKinshipLabel(daughterViewer, uncle), "عمك");
assert.equal(Kinship.resolveProvenKinshipLabel(daughterViewer, nephew), "ابن أخيك");
assert.equal(
  Kinship.resolveProvenKinshipLabel(daughterViewer, { id: 41, name: "لاحم/عيد/محمد/يوسف", parentName: "لاحم/عيد/محمد" }, "ابن أختك"),
  "ابن أختك",
);

const hiddenDaughterViewer = {
  id: 70,
  branchKey: "مزيد",
  parentName: viewer.parentName,
  name: viewer.parentName + "/*",
  gender: "daughter",
};
assert.equal(Kinship.resolveProvenKinshipLabel(hiddenDaughterViewer, father), "أبوك");
assert.equal(Kinship.resolveProvenKinshipLabel(hiddenDaughterViewer, uncle), "عمك");
assert.equal(Kinship.resolveProvenKinshipLabel(hiddenDaughterViewer, nephew), "ابن أخيك");
assert.equal(
  Kinship.resolveProvenKinshipLabel(
    hiddenDaughterViewer,
    { id: 41, name: "لاحم/عيد/محمد/يوسف", parentName: "لاحم/عيد/محمد" },
    "ابن أختك",
  ),
  "ابن أختك",
);

Kinship.setMemberState(daughterViewer, { 8: "عمك", 17: "ابن أخيك", 41: "ابن أختك" }, {}, [], ctx, true);
assert.equal(
  Kinship.encounterForCard({
    nodeId: uncle.name,
    branchKey: "مزيد",
    rows: [uncle],
  }).kinship,
  "عمك",
);
assert.equal(
  Kinship.encounterForCard({
    nodeId: nephew.name,
    branchKey: "مزيد",
    rows: [nephew],
  }).kinship,
  "ابن أخيك",
);

const daughterOfViewer = {
  id: 72,
  branchKey: "مزيد",
  parentName: viewer.name,
  name: viewer.name + "/نوره",
  gender: "daughter",
};
const daughterHusband = {
  id: 80,
  branchKey: "لاحم",
  parentName: "لاحم/عيد",
  name: "لاحم/عيد/سعد",
  gender: "son",
};
const daughterSon = {
  id: 81,
  branchKey: "لاحم",
  parentName: daughterHusband.name,
  name: daughterHusband.name + "/يوسف",
  gender: "son",
};
const sisterOfViewer = {
  id: 73,
  branchKey: "مزيد",
  parentName: viewer.parentName,
  name: viewer.parentName + "/نوال",
  gender: "daughter",
};
const sisterHusband = {
  id: 90,
  branchKey: "زايد",
  parentName: "زايد/مبارك",
  name: "زايد/مبارك/علي",
  gender: "son",
};
const sisterSon = {
  id: 91,
  branchKey: "زايد",
  parentName: sisterHusband.name,
  name: sisterHusband.name + "/ماجد",
  gender: "son",
};
const linkCtx = {
  children: ctx.children.concat([
    daughterOfViewer,
    daughterHusband,
    daughterSon,
    sisterOfViewer,
    sisterHusband,
    sisterSon,
  ]),
  spouses: ctx.spouses.concat([
    {
      id: 500,
      husbandId: 80,
      wifeName: "نوره",
      wifeLineage: daughterOfViewer.name,
      wifeIsFamilyMember: true,
      wifeBranchKey: "مزيد",
      status: "active",
    },
    {
      id: 600,
      husbandId: 90,
      wifeName: "نوال",
      wifeLineage: sisterOfViewer.name,
      wifeIsFamilyMember: true,
      wifeBranchKey: "مزيد",
      status: "active",
    },
  ]),
  motherLinks: ctx.motherLinks.concat([
    { childId: 81, spouseId: 500, confidence: "confirmed" },
    { childId: 91, spouseId: 600, confidence: "confirmed" },
  ]),
  viewerPerson: viewer,
};
assert.equal(
  Kinship.resolveProvenKinshipLabel(viewer, daughterSon, null, linkCtx),
  "حفيدك من ابنتك",
);
assert.equal(
  Kinship.resolveProvenKinshipLabel(daughterOfViewer, daughterSon, null, linkCtx),
  "ابنك",
);
assert.equal(
  Kinship.resolveProvenKinshipLabel(viewer, sisterSon, null, linkCtx),
  "ابن أختك",
);

const nasabWife = {
  id: 701,
  husbandId: 80,
  wifeName: "نوره",
  wifeLineage: "نوره حسن عيد",
  wifeIsFamilyMember: true,
  wifeBranchKey: "مزيد",
  status: "active",
};
const nasabCtx = {
  children: [viewer, father, daughterOfViewer, daughterHusband, daughterSon, sisterOfViewer, sisterHusband, sisterSon],
  spouses: [nasabWife],
  motherLinks: [{ childId: 81, spouseId: 701, confidence: "confirmed" }],
  viewerPerson: viewer,
};
assert.equal(
  Kinship.resolveProvenKinshipLabel(viewer, daughterSon, null, nasabCtx),
  "حفيدك من ابنتك",
  "نسب الزوجة يُطابق أباها لا اسمها الأول فقط",
);
assert.equal(
  Kinship.resolveProvenKinshipLabel(daughterOfViewer, daughterSon, null, nasabCtx),
  "ابنك",
  "نسب الزوجة يُطابق زوجها/نفسها فيظهر ابنها لها",
);
const wifeSister = {
  id: 74,
  branchKey: "مزيد",
  parentName: viewer.name,
  name: viewer.name + "/نوال",
  gender: "daughter",
};
nasabCtx.children.push(wifeSister);
assert.equal(
  Kinship.resolveProvenKinshipLabel(wifeSister, daughterSon, null, nasabCtx),
  "ابن أختك",
  "نسب الزوجة يُطابق أباها فتظهر لأختها",
);

const singleWifeCtx = {
  children: [viewer, father, daughterHusband, daughterSon],
  spouses: [
    {
      id: 500,
      husbandId: 80,
      wifeName: "نوره",
      wifeLineage: daughterOfViewer.name,
      wifeIsFamilyMember: true,
      wifeBranchKey: "مزيد",
      status: "active",
    },
  ],
  motherLinks: [],
  viewerPerson: viewer,
};
assert.equal(
  Kinship.resolveProvenKinshipLabel(viewer, daughterSon, null, singleWifeCtx),
  "حفيدك من ابنتك",
);

const inferKhalCtx = {
  children: [grandfather, khal, father, viewer, ibnKhal],
  spouses: [
    {
      id: 100,
      husbandId: 10,
      wifeName: "عقيله",
      wifeLineage: "ملقاط/خزيم/عقيله",
      wifeIsFamilyMember: true,
      wifeBranchKey: "خزيم",
      status: "active",
    },
  ],
  motherLinks: [],
  viewerPerson: viewer,
};
assert.equal(Kinship.resolveMaternalKinshipLabel(11, 3, inferKhalCtx), "خالك");
assert.equal(Kinship.resolveMaternalKinshipLabel(11, 20, inferKhalCtx), "ابن خالك");

Kinship.setMemberState(viewer, { 41: "ابن أختك", 42: "حفيدك من ابنتك" }, {}, [], ctx, true);
assert.equal(
  Kinship.encounterForCard({
    nodeId: "لاحم/عيد/محمد/يوسف",
    branchKey: "لاحم",
    rows: [{ id: 41, name: "لاحم/عيد/محمد/يوسف", parentName: "لاحم/عيد/محمد", branchKey: "لاحم" }],
  }).kinship,
  "ابن أختك",
);

Kinship.setMemberState(daughterOfViewer, {}, {}, nasabCtx.children, nasabCtx, true);
const stubRow = { name: daughterSon.name, parentName: daughterSon.parentName, branchKey: "لاحم" };
assert.equal(
  Kinship.findTarget(daughterSon.name, [stubRow], "لاحم", nasabCtx.children).id,
  81,
  "المسار بلا معرف يُحل إلى الابن الحقيقي",
);
assert.equal(
  Kinship.encounterForCard({
    nodeId: daughterSon.name,
    branchKey: "لاحم",
    rows: [stubRow],
  }).kinship,
  "ابنك",
  "ابن البنت يظهر لها ابنك حتى لو صف الشجرة بلا معرف",
);
assert.equal(
  Kinship.wifeRoleTowardViewer(nasabWife, daughterOfViewer),
  "self",
);
const yehPath = daughterSon.name.replace(/ي/g, "ى");
assert.equal(
  Kinship.encounterForCard({
    nodeId: yehPath,
    branchKey: "لاحم",
    rows: [stubRow],
  }).kinship,
  "ابنك",
  "ى و ي لا تمنع ابنك",
);

Kinship.clearMember();
assert.equal(
  Kinship.encounterForCard({
    nodeId: khuzaym + "/سالم",
    branchKey: "زيدان",
    rows: liveNasab.children,
  }).mode,
  "visitor",
);

Kinship.clearMember();

const wadhaFatherKhamis = {
  id: 2001,
  branchKey: "مزيد",
  parentName: "مزيد/دليميك",
  name: "مزيد/دليميك/خميس",
  gender: "son",
  personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
  parentPersonId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0",
};
const wadhaFatherMutlaq = {
  id: 2002,
  branchKey: "مزيد",
  parentName: "مزيد/دليميك",
  name: "مزيد/دليميك/مطلق",
  gender: "son",
  personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
  parentPersonId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa0",
};
const wadhaViewer = {
  id: 2100,
  branchKey: "مزيد",
  parentName: "مزيد/دليميك/خميس",
  name: "مزيد/دليميك/خميس/حسن",
  gender: "son",
  personId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
  parentPersonId: wadhaFatherKhamis.personId,
};
const wadhaSister = {
  id: 2101,
  branchKey: "مزيد",
  parentName: "مزيد/دليميك/خميس",
  name: "مزيد/دليميك/خميس/وضحاء",
  gender: "daughter",
  personId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2",
  parentPersonId: wadhaFatherKhamis.personId,
};
const wadhaCousin = {
  id: 2201,
  branchKey: "مزيد",
  parentName: "مزيد/دليميك/مطلق",
  name: "مزيد/دليميك/مطلق/وضحاء",
  gender: "daughter",
  personId: "cccccccc-cccc-cccc-cccc-ccccccccccc1",
  parentPersonId: wadhaFatherMutlaq.personId,
};
const wadhaCousinSon = {
  id: 2202,
  branchKey: "مزيد",
  parentName: "مزيد/دليميك/مطلق/وضحاء",
  name: "مزيد/دليميك/مطلق/وضحاء/زيد",
  gender: "son",
  personId: "cccccccc-cccc-cccc-cccc-ccccccccccc2",
  parentPersonId: wadhaCousin.personId,
};
const wadhaPeople = [
  wadhaFatherKhamis,
  wadhaFatherMutlaq,
  wadhaViewer,
  wadhaSister,
  wadhaCousin,
  wadhaCousinSon,
];
const wadhaSpouseOutside = {
  id: 9101,
  husbandId: 0,
  wifeName: "وضحاء",
  wifeLineage: "وضحاء",
  wifeIsFamilyMember: true,
  wifeBranchKey: "مزيد",
  status: "active",
};
const wadhaSpouseCousin = {
  id: 9102,
  husbandId: 9901,
  wifeName: "وضحاء مطلق دليميك",
  wifeLineage: wadhaCousin.name,
  wifeIsFamilyMember: true,
  wifeBranchKey: "مزيد",
  status: "active",
};
const wadhaCtx = {
  children: wadhaPeople,
  spouses: [wadhaSpouseOutside, wadhaSpouseCousin],
  motherLinks: [{ childId: wadhaCousinSon.id, spouseId: wadhaSpouseCousin.id, confidence: "confirmed" }],
  viewerPerson: wadhaViewer,
};

assert.equal(
  Kinship.resolveProvenKinshipLabel(wadhaViewer, wadhaSister, null, wadhaCtx),
  "أخت",
  "A) وضحاء خميس أخت وليست ابنة عم",
);
assert.equal(
  Kinship.resolveProvenKinshipLabel(wadhaViewer, wadhaCousin, null, wadhaCtx),
  "بنت عمي",
  "B) وضحاء مطلق بنت عم لا أخت",
);
assert.equal(
  Kinship.resolveProvenKinshipLabel(wadhaViewer, wadhaCousinSon, "ابن أختك", wadhaCtx),
  "ابن بنت عمي",
  "أبناء وضحاء مطلق لا يُحسبون أبناء أخت بسبب تطابق الاسم",
);
assert.equal(
  Kinship.findTarget("وضحاء مطلق دليميك", wadhaPeople, "مزيد").id,
  wadhaCousin.id,
  "اختيار وضحاء مطلق لا يعيد شخص وضحاء خميس",
);
assert.notEqual(
  Kinship.findTarget("وضحاء مطلق دليميك", wadhaPeople, "مزيد").id,
  wadhaSister.id,
);
assert.equal(
  Kinship.findTarget("وضحاء", wadhaPeople, "مزيد").id,
  0,
  "الاسم الأول وحده ليس هوية",
);
assert.equal(
  Kinship.uniqueByNasab(wadhaPeople, "مزيد", "وضحاء مطلق دليميك").id,
  wadhaCousin.id,
);
assert.equal(
  Kinship.uniqueByNasab(wadhaPeople, "مزيد", "وضحاء خميس دليميك خميس").id,
  wadhaSister.id,
);
assert.equal(
  Kinship.uniqueSpouseForSister([wadhaSpouseOutside, wadhaSpouseCousin], wadhaSister),
  null,
  "زوجة اسمها وضحاء فقط لا تُلصق بالأخت",
);
assert.equal(
  Kinship.wifeRoleTowardViewer(wadhaSpouseCousin, wadhaViewer, wadhaPeople),
  "cousinDaughter",
  "زوجة وضحاء مطلق بنت عم لا أخت",
);
assert.equal(
  Kinship.linkKinshipByTargetId(wadhaViewer, wadhaCtx)[wadhaCousinSon.id],
  "ابن بنت عمي",
);

const jayizRoot = "مزيد بن مطلق بن زيدان";
const jayizViewer = {
  id: 3100,
  branchKey: "مزيد",
  parentName: jayizRoot + "/خميس",
  name: jayizRoot + "/خميس/حسن",
  gender: "son",
};
const jayizArfaj = {
  id: 3101,
  branchKey: "مزيد",
  parentName: jayizRoot + "/خميس",
  name: jayizRoot + "/خميس/عرفج",
  gender: "son",
};
const jayizFayid = {
  id: 3102,
  branchKey: "مزيد",
  parentName: jayizArfaj.name,
  name: jayizArfaj.name + "/فايض",
  gender: "son",
};
const jayiz = {
  id: 3103,
  branchKey: "مزيد",
  parentName: jayizFayid.name,
  name: jayizFayid.name + "/جايز",
  gender: "son",
};
const jayizMutlaq = {
  id: 3200,
  branchKey: "مزيد",
  parentName: jayizRoot,
  name: jayizRoot + "/مطلق",
  gender: "son",
};
const jayizWadhaCousin = {
  id: 3201,
  branchKey: "مزيد",
  parentName: jayizMutlaq.name,
  name: jayizMutlaq.name + "/وضحاء",
  gender: "daughter",
};
const jayizMotherSpouse = {
  id: 9301,
  husbandId: jayizFayid.id,
  wifeName: "وضحاء مطلق دليميك",
  wifeLineage: jayizWadhaCousin.name,
  wifeIsFamilyMember: true,
  wifeBranchKey: "مزيد",
  status: "active",
};
const jayizCtx = {
  children: [jayizViewer, jayizArfaj, jayizFayid, jayiz, jayizMutlaq, jayizWadhaCousin],
  spouses: [jayizMotherSpouse],
  motherLinks: [{ childId: jayiz.id, spouseId: jayizMotherSpouse.id, confidence: "confirmed" }],
  viewerPerson: jayizViewer,
};
assert.equal(
  Kinship.wifeRoleTowardViewer(jayizMotherSpouse, jayizViewer, jayizCtx.children),
  "cousinDaughter",
);
assert.equal(
  Kinship.resolveProvenKinshipLabel(jayizViewer, jayiz, "ابن أختك", jayizCtx),
  "ابن بنت عمي",
  "جايز ابن وضحاء مطلق = ابن بنت عمي ولو سُجّل تحت فايض",
);

console.log("test-person-kinship: ok");
