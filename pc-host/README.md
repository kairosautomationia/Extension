# Hanzo PC

Componente local para que Hanzo maneje apps de escritorio en Windows con la habilidad `/pc`.

## Instalar (una vez por PC)
1. Necesitas Python 3 (python.org, con "Add python.exe to PATH").
2. En Chrome abre `chrome://extensions` y copia el ID de Hanzo.
3. Doble clic en `instalar.bat` y pega el ID.
4. En Hanzo escribe: `/pc abre el bloc de notas y escribe hola`.

## Seguridad
- Solo ve y toca las apps de `config.json` → `apps`. Las demás ventanas ni se listan.
- Solo lee o escribe archivos en `config.json` → `folders`.
- No toca campos de contraseña. Botones como Eliminar, Enviar o Pagar, teclas como Supr o Alt+F4 y escribir en Excel piden tu aprobación.
- Cada acción queda en `hanzo_pc.log`.
- Detener en Hanzo corta la conexión al instante.

## Agregar una app
En `config.json`, dentro de `apps`:
```json
"sistema contable": { "run": "C:\\Ruta\\Programa.exe", "exe": ["programa.exe"] }
```
`run` es lo que se ejecuta; `exe` es el nombre del proceso (lo ves en el Administrador de tareas → Detalles).

## Desinstalar
Doble clic en `desinstalar.bat`.
