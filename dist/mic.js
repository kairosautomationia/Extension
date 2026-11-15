const msg = document.getElementById('msg');
const go = document.getElementById('go');
async function ask() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    msg.textContent = 'Listo. Ya puedes cerrar esta pestaña y usar el botón de voz en Hanzo.';
    go.style.display = 'none';
    setTimeout(() => window.close(), 1800);
  } catch (e) {
    msg.textContent = 'No se concedió el permiso. Puedes cambiarlo en el candado de la barra de direcciones y volver a intentar.';
  }
}
go.addEventListener('click', ask);
ask();
