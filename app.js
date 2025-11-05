// ================================
// IndexedDB init
// ================================
let db;
const DB_NAME = "ore_lavoro_db";
const STORE = "presenze";

const openReq = indexedDB.open(DB_NAME, 1);
openReq.onupgradeneeded = e => {
  db = e.target.result;
  if (!db.objectStoreNames.contains(STORE)) {
    db.createObjectStore(STORE, { keyPath: "giorno" }); // giorno = "YYYY-MM-DD"
  }
};
openReq.onsuccess = e => { db = e.target.result; initCalendar(); };
openReq.onerror = e => console.error("IndexedDB error", e);

// ================================
// Utility DB
// ================================
function getAllEntries(){
  return new Promise(res=>{
    const tx = db.transaction([STORE], "readonly");
    const st = tx.objectStore(STORE);
    const rq = st.getAll();
    rq.onsuccess = ()=> res(rq.result || []);
  });
}
function getEntry(dateStr){
  return new Promise(res=>{
    const tx = db.transaction([STORE], "readonly");
    tx.objectStore(STORE).get(dateStr).onsuccess = e => res(e.target.result || null);
  });
}
function putEntry(obj){
  return new Promise(res=>{
    const tx = db.transaction([STORE], "readwrite");
    tx.objectStore(STORE).put(obj);
    tx.oncomplete = ()=> res(true);
  });
}
function deleteEntry(dateStr){
  return new Promise(res=>{
    const tx = db.transaction([STORE], "readwrite");
    tx.objectStore(STORE).delete(dateStr);
    tx.oncomplete = ()=> res(true);
  });
}

// ================================
// FullCalendar
// ================================
let selectedDate = null;
let calendar = null;

const COLORS = {
  "LAVORO":"#16a34a",   // verde
  "RIPOSO":"#0d6efd",   // blu
  "MALATTIA":"#f59e0b", // giallo
  "FERIE":"#ef4444",    // rosso
  "CHIUSO":"#4cbefc"    // celeste
};
const SHORT = {
  "LAVORO":"LAV",
  "RIPOSO":"RIP",
  "MALATTIA":"MAL",
  "FERIE":"FER",
  "CHIUSO":"CHI"
};
const ORE = { "LAVORO":8, "RIPOSO":4, "MALATTIA":0, "FERIE":0, "CHIUSO":0 };

function initCalendar(){
  calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
    locale: "it",
    buttonText: { today: "Oggi" },
    initialView: "dayGridMonth",
    firstDay: 1,
    height: "auto",
    dateClick: async (info)=>{
      selectedDate = info.dateStr;
      // evidenzia cella selezionata
      document.querySelectorAll('.fc-daygrid-day').forEach(el=>el.style.outline='');
      info.dayEl.style.outline='2px solid #000';
      // se esiste un record, offri modifica veloce
      const rec = await getEntry(selectedDate);
      if (rec) {
        // piccolo hint senza bloccare: niente alert, userà il bottone Modifica
        // console.log("Selezionato con record", rec);
      }
    },
    events: async (info, success)=>{
      const rows = await getAllEntries();
      const events = rows.map(r => ({
        title: SHORT[r.stato] + (ORE[r.stato] ? ` (${ORE[r.stato]}h)` : ''),
        start: r.giorno,
        backgroundColor: COLORS[r.stato],
        borderColor: COLORS[r.stato]
      }));
      success(events);
    }
  });
  calendar.render();
}

// ================================
// Actions
// ================================
async function setState(stato){
  if(!selectedDate){ alert("Seleziona un giorno sul calendario."); return; }
  const rec = { giorno: selectedDate, stato, ore: ORE[stato] || 0 };
  await putEntry(rec);
  calendar.refetchEvents();
}

async function deleteDay(){
  if(!selectedDate){ alert("Seleziona un giorno."); return; }
  await deleteEntry(selectedDate);
  calendar.refetchEvents();
}

async function editDay(){
  if(!selectedDate){ alert("Seleziona un giorno."); return; }
  const current = await getEntry(selectedDate);

  const options = ["LAVORO","RIPOSO","MALATTIA","FERIE","CHIUSO"];
  const labels = {
    LAVORO: "Lavoro (8h)",
    RIPOSO: "Riposo (4h)",
    MALATTIA: "Malattia (0h)",
    FERIE: "Ferie (0h)",
    CHIUSO: "Chiuso (0h)"
  };

  // prompt semplice (compatibile mobile). Puoi sostituire con modal Bootstrap se vuoi.
  const msg = "Modifica stato per " + selectedDate +
              (current ? `\nAttuale: ${current.stato}` : "") +
              "\n\nScegli: LAVORO / RIPOSO / MALATTIA / FERIE / CHIUSO";
  const val = (prompt(msg) || "").toUpperCase().trim();

  if (!options.includes(val)) { if(val) alert("Valore non valido."); return; }
  const rec = { giorno: selectedDate, stato: val, ore: ORE[val] || 0 };
  await putEntry(rec);
  calendar.refetchEvents();
}

// ================================
// Backup
// ================================
async function exportBackup(){
  const data = await getAllEntries();
  const blob = new Blob([JSON.stringify(data)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "presenze_backup.json";
  a.click();
}

function importBackup(){
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "application/json";
  inp.onchange = e=>{
    const file = e.target.files[0];
    if(!file) return;
    const r = new FileReader();
    r.onload = async ()=>{
      const arr = JSON.parse(r.result || "[]");
      const tx = db.transaction([STORE], "readwrite");
      const st = tx.objectStore(STORE);
      arr.forEach(x=> st.put(x));
      tx.oncomplete = ()=> { calendar.refetchEvents(); alert("Backup importato!"); };
    };
    r.readAsText(file);
  };
  inp.click();
}

// ================================
// Stampa PDF (solo calendario, A4, zoom 3x per leggibilità)
// ================================
async function stampaPDF(){
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p','mm','a4');

  const area = document.getElementById('calendar');
  const canvas = await html2canvas(area, { scale: 3 }); // zoom per testo nitido

  const imgData = canvas.toDataURL('image/jpeg', 1.0);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const imgWidth = pageWidth;
  const imgHeight = canvas.height * imgWidth / canvas.width;
  const y = Math.max(0, (pageHeight - imgHeight) / 2);

  // Titolo in alto (mese/anno attuale)
  const title = document.querySelector('.fc-toolbar-title')?.textContent || 'Presenze';
  pdf.setFontSize(14);
  pdf.text(title, 10, 10);

  // Immagine sotto titolo (lascia un margine)
  const topMargin = 14;
  pdf.addImage(imgData, 'JPEG', 0, y + topMargin, imgWidth, imgHeight);

  // Legenda in basso
  const legend = "Legenda: LAV=8h · RIP=4h · MAL=Malattia · FER=Ferie · CHI=Chiuso";
  pdf.setFontSize(10);
  pdf.text(legend, 10, pageHeight - 8);

  pdf.save("presenze.pdf");
}
