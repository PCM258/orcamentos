# PC Orçamentos

Aplicação web (PWA) para orçamentos de projeto e de obra em meticais: honorários com descontos, propostas, pagamentos e recibos, estrutura em betão por traço, alvenaria por tipo de bloco, portas e janelas, materiais por piso e mão de obra.

- Funciona no navegador do PC, Android e iPhone, e pode ser instalada no ecrã principal.
- Funciona sem internet depois da primeira abertura.
- Lê modelos IFC exportados do ArchiCAD.
- Os dados (obras, clientes, preços) ficam guardados apenas no aparelho de cada utilizador; este repositório contém só o programa.

Testar no PC: `powershell -ExecutionPolicy Bypass -File serve.ps1` e abrir http://localhost:8765/
