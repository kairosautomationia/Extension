# Hanzo PC

Componente local para que Hanzo maneje apps de escritorio en Windows con la habilidad `/pc`.

## Instalar (una vez por PC)
1. Necesitas Python 3 (python.org, con "Add python.exe to PATH") y Hanzo cargada en Chrome.
2. Doble clic en `instalar.bat`. Detecta solo la extensión; no tienes que copiar nada.
3. En `chrome://extensions` pulsa **Recargar** en Hanzo.
4. Pide cosas como: `/pc abre el bloc de notas y escribe hola`. También funciona con `/hacer` o por voz: si la tarea es de una app de escritorio, Hanzo cambia solo.

## Seguridad
- Solo ve y toca las apps de `config.json` → `apps`. Las demás ventanas ni se listan.
- Solo lee o escribe archivos en `config.json` → `folders`.
- No toca campos de contraseña. Botones como Eliminar, Enviar o Pagar, teclas como Supr o Alt+F4 y escribir en Excel piden tu aprobación.
- Cada acción queda en `%LOCALAPPDATA%\HanzoPC\hanzo_pc.log` (fuera de OneDrive).
- Detener en Hanzo corta la conexión al instante.

## Agregar una app
En `config.json`, dentro de `apps`:
```json
"sistema contable": { "run": "C:\\Ruta\\Programa.exe", "exe": ["programa.exe"] }
```
`run` es lo que se ejecuta; `exe` es el nombre del proceso (lo ves en el Administrador de tareas → Detalles).

## Desinstalar
Doble clic en `desinstalar.bat`.
