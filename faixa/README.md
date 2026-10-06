# Faixa de Opções para o Thunderbird

Complemento da Bluecker que recria no Thunderbird a faixa de opções da janela de composição do Outlook, com o Pincel de Formatação. Esta é a **0.7.1**: abas Mensagem, Inserir, Formatar Texto e Ajuda, a **Visualização Dinâmica**, as **confirmações de entrega e de leitura**, o **Acompanhamento**, a opção de **ocultar a barra de menus** da janela de mensagem e a faixa em **seis idiomas** (português, inglês, espanhol, italiano, alemão e francês). Feita para o **Thunderbird ESR 153** (testada também no 156).

- ID: `faixa@bluecker.com` · versão 0.7.1 · Manifest V3 com WebExtension Experiment
- **Confirmação de Entrega e de Leitura** (grupo Controle da aba Mensagem): as mesmas do menu Opções do Thunderbird. Os botões já abrem acesos quando a conta pede as confirmações por padrão e acompanham o menu Opções e a troca de conta no De:
- **Acompanhamento ▾**, como o Sinalizar para Acompanhamento do Outlook: **Sinalizar para Mim** (depois do envio, a cópia em Enviados fica com a estrela do Thunderbird, também com Enviar mais tarde), **Sinalizar para os Destinatários** (o Outlook de quem recebe mostra o sinalizador) e **Limpar Sinalizador**. O rascunho guarda o que foi escolhido
- **Barra de menus** (Arquivo, Editar, Exibir, Inserir, Formatar...): oculta por padrão na janela de mensagem, deixando só a faixa no topo; volta pelo menu ⋯ da faixa, pelas Opções da Faixa ou pela política. A tecla Alt (ou F10) mostra os menus enquanto são usados, como na opção Barra de Menus do próprio Thunderbird, que continua valendo
- **Seis idiomas**: português (Brasil), inglês, espanhol, italiano, alemão e francês, com os termos do Office de cada idioma (Copiar formato, Copia formato, Format übertragen, Reproduire la mise en forme...) e as teclas escritas como no idioma (Strg+Umschalt+V, Ctrl+Maj+V); a faixa segue o idioma do Thunderbird, ou o escolhido nas Opções da Faixa
- **Visualização Dinâmica**, como no Office: com o mouse (ou o foco do teclado) numa fonte, num tamanho, numa cor da fonte ou do realce, ou num estilo da galeria, o texto mostra como vai ficar antes do clique; saindo, volta. Vale para a seleção (com o cursor numa palavra, para a palavra; nos estilos de parágrafo, para o parágrafo). A prévia não entra no Desfazer e a mensagem não conta como alterada. Liga e desliga nas Opções da Faixa ou pela política
- **Aba Inserir**, como no Outlook: Anexar Arquivo, **Anexar Mensagem** (das pastas de todas as contas, vai como `.eml`), **Cartão de Visita** (o seu ou o de contatos dos catálogos), Assinatura, **Tabela** (grade de até 10 × 8 e os comandos de linhas, colunas e células), Imagens, Link, Indicador, **Partes Rápidas**, **Data e Hora**, **Emoji**, **Símbolo** e Linha Horizontal
- **Partes Rápidas centralizadas**: a organização define trechos prontos por política, com os mesmos campos das assinaturas ({nome}, {cargo}, {telefone}...); o usuário salva a seleção na galeria e edita as dele na página **Partes Rápidas**
- **Aba Ajuda**: Ajuda (a da organização, se a política definir), Atalhos de Teclado, Opções da Faixa e Sobre. O diagnóstico abre pelo ⋯ da faixa, pelo Sobre e pelas Opções da Faixa
- Galeria de estilos com **Subtítulo, Ênfase Sutil, Ênfase, Ênfase Intensa e Forte**, como no Word; **Texto sem Formatação** tira a formatação do corpo, como no Outlook, e o grupo Formato avisa "Formatação desativada"
- **Verificar Nomes** (Ctrl+K no Para, Cc ou Cco): completa pelos catálogos de endereços o nome digitado; nome com mais de um resultado abre a escolha; nome desconhecido fica em vermelho
- **Catálogo de Endereços** abre **Selecionar Nomes**, com pesquisa nos catálogos e os botões Para, Cc e Cco
- **Assinaturas** como no Outlook: várias, com a padrão de cada conta para mensagens novas e para respostas e encaminhamentos, o menu **Assinatura ▾** na mensagem e a página **Assinaturas**. A organização pode definir assinaturas e padrões por política, com campos preenchidos por conta
- Menu **Arquivo** (Salvar Rascunho, Salvar como Modelo, Salvar como Arquivo, Imprimir, Opções da Faixa, Fechar) e **Salvar** na barra de acesso rápido, junto de Desfazer e Refazer
- **Maiúsculas e Minúsculas**, **Adicionar/Remover Espaço Antes e Depois do Parágrafo** e o menu **Anexar Arquivo** (computador, Filelink, página da web, cartão de visita, chave OpenPGP)
- Como no Outlook, a formatação só vale com o foco no corpo: no Para ou no Assunto os botões de formatação e o que entra no corpo ficam desativados
- **Teclado** como no Office: F6 passa pela faixa, as setas andam dentro dela (também nas grades de tabela, emoji e símbolos), Esc volta; **alto contraste** do Windows
- Fonte padrão Calibri 11; Enter cria parágrafo sem espaçamento, como no Outlook, mesmo com "Usar formato Parágrafo" desligado no Thunderbird
- A barra principal do Thunderbird fica oculta e o botão Enviar fica ao lado dos destinatários
- Delete numa sugestão destacada do autocompletar de destinatários tira o endereço da lista, como no Outlook

## Instalar

### Numa máquina, para testar

1. No Thunderbird: **Ferramentas → Extensões e temas**.
2. Engrenagem → **Instalar extensão a partir de arquivo…** → escolha `faixa-0.7.1.xpi`. Por cima de uma versão anterior, é só instalar: as preferências, as assinaturas e as Partes Rápidas continuam.
3. O Thunderbird avisa que a extensão pede **acesso total**. É esperado: a faixa é um *Experiment*, que roda dentro do Thunderbird para mexer na janela de composição.

Para uma sessão só (some ao fechar o Thunderbird): **Ferramentas → Ferramentas de desenvolvimento → Depurar extensões → Este Thunderbird → Carregar extensão temporária…** e escolha o `.xpi` ou o `manifest.json` da pasta do código.

O Thunderbird não exige assinatura de complementos por padrão (`xpinstall.signatures.required` é falso). Confira isso no ESR 153 da frota antes de distribuir.

### Na frota, por política

Crie ou complete o `policies.json` na pasta `distribution` da instalação do Thunderbird. No Windows é `C:\Program Files\Mozilla Thunderbird\distribution\policies.json`; os modelos ADMX também servem. `ExtensionSettings` com `install_url` existe desde o Thunderbird 89, e `3rdparty` desde o 78.

```json
{
  "policies": {
    "ExtensionSettings": {
      "faixa@bluecker.com": {
        "installation_mode": "force_installed",
        "install_url": "https://suporte.exemplo.com.br/faixa/faixa-0.7.1.xpi"
      }
    },
    "3rdparty": {
      "Extensions": {
        "faixa@bluecker.com": {
          "fontePadrao": { "familia": "Calibri", "tamanhoPt": 11 },
          "ocultarBarraThunderbird": true,
          "ocultarBarraMenus": true,
          "paragrafoSemEspaco": true,
          "perfilAtalhos": "thunderbird-office",
          "abaInicial": "mensagem",
          "idioma": "auto",
          "visualizacaoDinamica": true,
          "suporte": {
            "nome": "Service Desk Bluecker",
            "email": "suporte@bluecker.com",
            "telefone": "+55 11 5555-0000",
            "portal": "https://suporte.bluecker.com"
          }
        }
      }
    }
  }
}
```

Troque a URL pelo servidor interno. O que vier em `3rdparty` vale acima da escolha do usuário. Nas **Opções da Faixa**, o que a política define aparece travado, com um cadeado; no menu ⋯ da faixa, os itens da barra do Thunderbird e da barra de menus também ficam travados quando a política os define. O resto o usuário ainda muda.

| Chave | Valores | Padrão |
|---|---|---|
| `fontePadrao` | `{ "familia": nome, "tamanhoPt": número }` | Calibri, 11 |
| `ocultarBarraThunderbird` | `true` / `false` | `true` |
| `ocultarBarraMenus` | `true` / `false` (a barra de menus da janela de mensagem; o Alt mostra os menus) | `true` (oculta) |
| `paragrafoSemEspaco` | `true` / `false` | `true` |
| `perfilAtalhos` | `thunderbird-office` / `office-ptbr` | `thunderbird-office` |
| `abaInicial` | `mensagem` / `inserir` / `formatar` / `ajuda` | `mensagem` |
| `idioma` | `auto` (o do Thunderbird) / `pt-BR` / `en-US` / `es` / `it` / `de` / `fr` | `auto` |
| `recolhida` | `true` / `false` (a faixa abre só com os nomes das abas) | `false` |
| `visualizacaoDinamica` | `true` / `false` (prévia de fontes, cores e estilos ao passar o mouse) | `true` |
| `assinaturas` | lista de `{ "id", "nome", "html" }` (ver abaixo) | nenhuma |
| `assinaturaPadrao` | `{ "e-mail, @domínio ou *": { "nova": id, "resposta": id } }` | nenhum |
| `partesRapidas` | lista de `{ "id", "nome", "html" }` (ver abaixo) | nenhuma |
| `suporte` | `{ "nome", "email", "telefone", "portal", "ajuda" }` (ver abaixo) | nenhum |

#### Assinaturas da organização

```json
"faixa@bluecker.com": {
  "assinaturas": [
    { "id": "bluecker", "nome": "Bluecker",
      "html": "<div style=\"font-family: Calibri, sans-serif; font-size: 10pt\"><b>{nome}</b><br>{cargo} · {departamento}<br>Tel.: {telefone}<br>Cel.: {celular}<br><a href=\"mailto:{email}\">{email}</a><br><img src=\"https://www.bluecker.com/logo-assinatura.png\" width=\"160\" height=\"40\" alt=\"Bluecker\"></div>" }
  ],
  "assinaturaPadrao": {
    "@bluecker.com": { "nova": "bluecker", "resposta": "bluecker" },
    "suporte@bluecker.com": { "resposta": null }
  }
}
```

- As assinaturas da política aparecem primeiro no menu **Assinatura ▾** e na página **Assinaturas**, marcadas como da organização: o usuário usa e duplica, mas não edita nem exclui. As dele continuam valendo junto.
- Em `assinaturaPadrao`, cada conta procura primeiro o e-mail exato, depois o domínio (`@bluecker.com`) e por fim `*` (todas as contas). `nova` vale para mensagens novas; `resposta`, para respostas e encaminhamentos. `null` quer dizer nenhuma assinatura. Conta sem regra fica com a assinatura das Configurações da conta do Thunderbird.
- A política vence o usuário **campo a campo**: com só `nova` definida, o usuário ainda escolhe a de respostas. O que a política define aparece travado, com cadeado.
- Os campos entre chaves vêm da identidade (nome, e-mail, organização) e do cartão de visita dela (vCard, em Configurações da conta → Editar cartão): `{nome}`, `{email}`, `{cargo}`, `{departamento}`, `{organizacao}`, `{telefone}`, `{celular}`, `{site}` (também em inglês: `{name}`, `{title}`, `{phone}`...). A linha cujos campos ficam todos vazios sai da assinatura, e um campo vazio leva junto o separador ao lado (`·`, `|`, `-`, `,`).
- O HTML passa por uma limpeza: ficam texto, formatação, tabelas, links `http`, `https`, `mailto` e `tel` e imagens `https`, `cid` e `data:` (PNG, JPEG, GIF, WebP). Scripts, eventos, formulários e estilos com `url()` saem. Imagem `https` é baixada por quem recebe; para ir junto com a mensagem, use `data:` (o Thunderbird envia como imagem embutida).

#### Partes Rápidas da organização

```json
"faixa@bluecker.com": {
  "partesRapidas": [
    { "id": "endereco", "nome": "Endereço da Bluecker", "html": "<p>Bluecker · Av. Paulista, 1000 · São Paulo – SP</p>" },
    { "id": "confidencial", "nome": "Aviso de confidencialidade",
      "html": "<p style=\"font-size: 8pt; color: #595959\">Esta mensagem pode conter informação confidencial. Se você a recebeu por engano, avise o remetente e apague-a.</p>" },
    { "id": "contato", "nome": "Meu contato", "html": "<b>{nome}</b><br>{cargo} · {departamento}<br>{telefone}" }
  ]
}
```

- Aparecem primeiro em **Inserir → Partes Rápidas ▾** e na página **Partes Rápidas**, marcadas como da organização: o usuário usa e duplica, mas não muda nem exclui. As dele continuam valendo junto; um id repetido vale o da política, e Salvar Seleção na Galeria não aceita o nome de uma parte da organização.
- Os campos e a limpeza do HTML são os das assinaturas; os campos são preenchidos pela conta do De: na hora de inserir. Uma Parte Rápida tem até 1 MB, com as imagens.
- A parte entra no ponto do cursor, com a formatação, num passo só do desfazer. Numa mensagem que vai como texto sem formatação, ou no editor de texto puro, entra só o texto.

#### Contato do suporte (aba Ajuda)

```json
"faixa@bluecker.com": {
  "suporte": {
    "nome": "Service Desk Bluecker",
    "email": "suporte@bluecker.com",
    "telefone": "+55 11 5555-0000",
    "portal": "https://suporte.bluecker.com",
    "ajuda": "https://suporte.bluecker.com/faixa"
  }
}
```

- O contato do suporte aparece na página de ajuda da faixa. Desde a 0.7.1 a faixa não tem o botão Contatar o Suporte.
- **Ajuda** abre o endereço `ajuda` no navegador do sistema. Sem ele, abre a página de ajuda da faixa, que também mostra o contato do suporte.
- `portal` e `ajuda` só valem com `http` ou `https`; o `email` precisa de um `@`. O que não valer é ignorado.

Com `paragrafoSemEspaco` ligado, cada janela de composição usa parágrafos, mesmo com **Configurações → Redação → "Usar formato Parágrafo em vez de Texto do corpo"** desligado. A preferência do usuário não é alterada.

Se o Thunderbird também deve montar respostas e assinaturas em parágrafos, a política liga a preferência dele, dentro de `policies`. `"Status": "user"` aplica aos perfis existentes, e o usuário ainda pode mudar depois:

```json
"Preferences": {
  "mail.compose.default_to_paragraph": { "Value": true, "Status": "user" }
}
```

### Atualização automática

```
python3 tools/build.py --update-url https://suporte.exemplo.com.br/faixa/updates.json --xpi-url https://suporte.exemplo.com.br/faixa/
```

O comando põe `update_url` no manifesto e gera `dist/updates.json` com o sha256 do pacote. Publique os dois arquivos nessa pasta. Sem argumentos, o `build.py` só gera `dist/faixa-<versão>.xpi`.

## Opções, autoteste e diagnóstico

**Extensões e temas → Faixa de Opções → Opções** (ou **Arquivo → Opções da Faixa…** e **Ajuda → Opções da Faixa…** na janela de composição) abre as **Opções da Faixa**:

- idioma da faixa (automático, português, inglês, espanhol, italiano, alemão ou francês), aba que abre primeiro, faixa recolhida, barra do Thunderbird e **barra de menus**;
- **Habilitar Visualização Dinâmica**;
- fonte padrão das mensagens novas, com prévia e aviso quando a fonte não está instalada;
- Enter sem espaço entre parágrafos;
- perfil de atalhos;
- os botões **Assinaturas…**, **Partes Rápidas…** e **Ajuda**;
- **Restaurar os padrões** (as assinaturas e as Partes Rápidas continuam).

A página **Assinaturas** (também em **Assinatura ▾ → Assinaturas…**, na mensagem) funciona como a do Outlook:

- a lista de assinaturas, com **Nova**, **Duplicar** e **Excluir** (F2 na lista vai para o nome);
- o editor, com fonte, tamanho em pt, negrito, itálico, sublinhado, cor, alinhamento, link, imagem (reduzida para no máximo 600 × 300 px ao entrar), **Inserir campo** e limpar formatação; colar do Word ou de uma página passa pela limpeza;
- a pré-visualização com os dados de cada conta, e a tabela dos campos com o valor de cada um nessa conta;
- a **assinatura padrão de cada conta**, para mensagens novas e para respostas e encaminhamentos; "Do Thunderbird" deixa a das Configurações da conta;
- **Importar assinaturas do Thunderbird**: traz as das Configurações das contas (texto, HTML ou o arquivo escolhido lá) e passa a usá-las como padrão nas contas que seguiam o Thunderbird. Nas respostas, só onde o Thunderbird punha a assinatura.

A página **Partes Rápidas** (também em **Inserir → Partes Rápidas ▾ → Partes Rápidas…**) tem a mesma lista, o mesmo editor, os campos e a pré-visualização por conta. A imagem entra reduzida para no máximo 1000 × 1000 px; uma parte acima de 1 MB não é gravada, e a página avisa.

Cada mudança é salva na hora e já vale nas janelas de composição abertas. Se outra janela gravar ao mesmo tempo (**Salvar Seleção na Galeria de Partes Rápidas**, outra aba da mesma página), as duas mudanças ficam. Recolher ou fixar a faixa numa mensagem (Ctrl+F1) também muda a opção "faixa recolhida", como no Outlook.

A página **Ajuda** (aba Ajuda → **Ajuda**, sem endereço da organização) resume as abas, as tarefas mais comuns, o teclado e o que fazer quando algo não funciona, com o contato do suporte da política.

**Ajuda → Sobre → Diagnóstico da Faixa**, o botão das opções e o ⋯ da faixa levam à página de diagnóstico; **Ajuda → Atalhos de Teclado** abre a mesma página na tabela de atalhos:

- **Executar autoteste** abre uma mensagem de teste, confere os itens e fecha a mensagem sem salvar. Os itens:
  - montagem, barras ocultas, barra de menus como configurada e Enviar ao lado dos destinatários;
  - menu Arquivo e Salvar na barra de acesso rápido;
  - idioma da faixa;
  - formatação desativada com o foco no Assunto;
  - negrito com um Ctrl+Z e palavra inteira;
  - estado da seleção e fonte padrão;
  - tamanho em pt;
  - Maiúsculas e Minúsculas (numa seleção que passa por um negrito) e espaço antes do parágrafo;
  - pincel (uma vez e travado);
  - Enter sem espaço e ¶;
  - fontes instaladas e levantamento de teclas;
  - evento MV3 e prioridade;
  - Confirmação de Entrega e de Leitura, ligadas pelos botões e conferidas no menu Opções do Thunderbird, e desligadas de novo;
  - Acompanhamento: Sinalizar para Mim com o botão aceso, Sinalizar para os Destinatários com o cabeçalho na mensagem e Limpar Sinalizador;
  - Verificar Nomes e Selecionar Nomes, num catálogo de endereços temporário ("Faixa de Opções — autoteste"), apagado no fim;
  - assinatura padrão no lugar da do Thunderbird, fora do desfazer, e a troca pelo menu com um Ctrl+Z;
  - tabela pela grade, com o cursor na primeira célula e uma linha embaixo, Inserir Linhas Abaixo pelo Thunderbird e dois Ctrl+Z;
  - Símbolo e Data e Hora no cursor, um Ctrl+Z cada;
  - Parte Rápida com o campo preenchido pela conta, desfeita com um Ctrl+Z;
  - estilo Ênfase Intensa como no Word, com a galeria acesa;
  - Texto sem Formatação e a volta com um Ctrl+Z;
  - Visualização Dinâmica de fonte, cor e estilo: o corpo e a seleção voltam iguais, o contador de alterações não muda e o Ctrl+Z seguinte ainda desfaz a última edição de verdade;
  - normalização do envio e a volta dela;
  - desempenho: faixa montada em até 100 ms e estado da seleção em até 16 ms.
- **Atalhos de teclado** mostra, para cada atalho do Office, o que acontece aqui: faixa, igual ao Thunderbird, conflito ou livre. O levantamento é feito ao vivo quando há uma janela de composição aberta.
- **Teste de teclado**: pressione uma combinação no campo e veja como a faixa lê aquela tecla naquele teclado.
- **Copiar relatório** copia tudo em texto: ambiente, autoteste, atalhos, teste de teclado, fontes e configuração. É o que deve voltar para a Bluecker.

**Ajuda → Sobre** mostra a versão da faixa, a do Thunderbird, o sistema e o idioma, com um botão para o diagnóstico.

### Conferência manual no ESR 153

O autoteste não cobre o que depende de servidor, de outro programa ou do teclado físico:

1. **Envio real** para uma caixa Gmail e uma Outlook/Exchange: a fonte chega Calibri 11 e os parágrafos chegam sem espaço extra.
2. **Envio que falha** (SMTP errado ou desligado): depois do erro, o corpo e o cursor voltam exatamente como estavam, e o Ctrl+Z continua funcionando.
3. **Teclado ABNT2 no Windows**:
   - AltGr+2 e Ctrl+Alt+2 digitam ²; AltGr+Q digita /; AltGr+C digita ₢.
   - Com o Ctrl e o Alt da esquerda, Ctrl+Alt+C copia a formatação e Ctrl+Alt+V cola.
   - O "Teste de teclado" do diagnóstico mostra a leitura de cada combinação.
4. **Pincel com o mouse**:
   - clique no pincel e depois numa palavra;
   - arraste sobre um trecho;
   - duplo clique no pincel para travar;
   - Esc para sair.
5. **Resposta a um e-mail**, em HTML do Outlook e em texto puro: Ctrl+A e depois Limpar Toda a Formatação.
   - Só o texto do autor perde a formatação.
   - A citação mantém negritos, cores e quebras de linha.
   - A assinatura não muda.
6. **Tab no Assunto** vai para o corpo da mensagem, não para o Enviar.
7. **"Usar formato Parágrafo" desligado** (Configurações → Redação): mensagem nova e resposta começam num parágrafo, e o Enter cria outro. O diagnóstico mostra o estado dessa opção em Ambiente.
8. **Sugestões do autocompletar**: digite parte de um endereço em Para, desça com as setas até uma sugestão e aperte Delete.
   - Endereço coletado (alguém para quem você já escreveu) sai da lista.
   - Contato de um catálogo seu fica, e a faixa avisa onde ele está.
9. **Criptografia e outros complementos**: se a máquina usa OpenPGP/S/MIME ou tem botões de outros complementos, veja a primeira limitação abaixo.
10. **Arquivo**: Salvar Rascunho, Salvar como Modelo, Imprimir e Fechar fazem o mesmo que no Thunderbird. O Salvar da barra de acesso rápido grava em Rascunhos.
11. **Anexar Arquivo ▾**: com uma conta Filelink configurada, ela aparece no menu. Cartão de visita e chave OpenPGP marcam e desmarcam como no menu Anexar do Thunderbird.
12. **Maiúsculas e Minúsculas** (Formatar Texto → Fonte): numa frase com negrito, link e acentos, cada opção do menu mantém o negrito e o link e desfaz com um Ctrl+Z.
13. **Espaço antes/depois** (Espaçamento de Linha e Parágrafo ▾): o parágrafo ganha 12 pt e o menu passa a oferecer Remover. Numa mensagem enviada, o espaço chega igual.
14. **Foco**: com o cursor no Para ou no Assunto, Negrito, Fonte, os estilos, Tabela, Imagens, Emoji e Símbolo ficam desativados; Recortar, Copiar, Colar, Anexar Mensagem e Cartão de Visita continuam. De volta ao corpo, tudo volta.
15. **Teclado**:
    - F6 (e Shift+F6) passa pela faixa; ← → trocam de aba; ↓ entra nos comandos; Enter executa no corpo; Esc volta.
    - Com a faixa recolhida (Ctrl+F1), clicar numa aba abre a faixa por cima da mensagem; o comando escolhido fecha.
16. **Idioma**: nas Opções da Faixa, troque para English, Español, Italiano, Deutsch e Français com uma mensagem aberta; a faixa muda na hora, na mesma aba. Com o Thunderbird num desses idiomas e a opção em Automático, a faixa já abre nele. Em alemão, as dicas mostram Strg e Umschalt.
17. **Alto contraste**: com um tema de contraste do Windows (Configurações → Acessibilidade → Temas de contraste), botões acesos, foco, menus e as grades de tabela, emoji e símbolos continuam visíveis.
18. **Verificar Nomes**: no Para, digite parte de um nome de um catálogo seu, parte de um nome repetido e um nome que não existe, separados por ponto e vírgula, e aperte Ctrl+K.
    - O primeiro vira destinatário; o repetido abre a escolha (setas e Enter; Mostrar Mais Nomes… abre Selecionar Nomes); o desconhecido fica em vermelho.
    - Com catálogo LDAP ou CardDAV, confira que os contatos de lá também aparecem (LDAP responde em até 5 s).
19. **Catálogo de Endereços**: pesquise, escolha vários com Ctrl e Shift, mande para Para, Cc e Cco e confira que o Cco aparece.
20. **Assinaturas**, com duas contas:
    - nas Assinaturas, importe a do Thunderbird, crie outra com logotipo e campos e defina padrões diferentes para as contas;
    - mensagem nova, resposta por cima e por baixo da citação e encaminhamento: a assinatura certa, no lugar certo, sem o "-- ";
    - troque a conta no De: com a mensagem aberta: a assinatura muda para a da outra conta;
    - Assinatura ▾ troca a que está na mensagem, e um Ctrl+Z volta;
    - envie para o Gmail e para o Outlook: o logotipo chega junto (embutido) e a fonte da assinatura é a dela.
21. **Tabela** (Inserir → Tabela ▾):
    - pela grade, no meio de um parágrafo, no fim da mensagem, logo antes da assinatura, no fim de um texto colorido pela faixa e depois de uma linha em branco: o cursor vai para a primeira célula, sempre há uma linha para escrever embaixo da tabela (no texto colorido, ela continua colorida) e a linha em branco continua lá;
    - Inserir Linhas e Colunas, Excluir, Mesclar Células (com a célula da direita ou várias selecionadas), Dividir Células (numa célula mesclada) e Propriedades da Tabela… fazem o mesmo que o menu Tabela do Thunderbird; Inserir Tabela… abre a janela dele;
    - envie para o Gmail e para o Outlook: a tabela chega com a largura toda e bordas finas pretas.
22. **Anexar Mensagem**: numa pasta local e numa IMAP, com e sem mensagem selecionada na janela principal (a selecionada vem marcada); pesquise pelo assunto e pelo remetente; anexe duas. Quem recebe abre cada `.eml` como mensagem.
23. **Cartão de Visita ▾**: Meu Cartão de Visita (vCard) marca e desmarca como no Thunderbird; Outros Cartões de Visita… anexa o `.vcf` de dois contatos (um de CardDAV, se houver). Feche a mensagem sem enviar: os arquivos temporários somem da pasta temporária do sistema.
24. **Imagens, Link, Indicador, Linha Horizontal e Símbolo → Mais Símbolos…** abrem as janelas do Thunderbird e o resultado entra no cursor.
25. **Emoji e Símbolo**: entram no cursor e saem com um Ctrl+Z; no Windows, a tecla do Windows + . abre o painel de emoji do sistema; o símbolo usado passa para o começo do menu Símbolo.
26. **Data e Hora**: a lista em português e, trocando o idioma na janela, em inglês; Enter insere; o formato escolhido vem marcado da próxima vez.
27. **Partes Rápidas**, com a política de exemplo:
    - numa conta com cartão de visita, a Parte Rápida "Meu contato" entra com os campos preenchidos;
    - selecione um trecho com negrito e imagem e use Salvar Seleção na Galeria de Partes Rápidas: ele aparece nas outras janelas abertas e na página Partes Rápidas;
    - com a página Partes Rápidas aberta, salve outra seleção numa mensagem: a nova aparece na lista, e o que você digitava na página continua lá;
    - numa mensagem em Texto sem Formatação, a parte entra só como texto.
28. **Ajuda**:
    - a aba tem Ajuda, Atalhos de Teclado, Opções da Faixa e Sobre (sem Contatar o Suporte nem Diagnóstico da Faixa);
    - sem política: Ajuda abre a página da faixa; com a política de exemplo, abre o endereço da organização no navegador;
    - Sobre mostra as versões certas.
29. **Estilos novos e Texto sem Formatação**:
    - aplique Subtítulo, Ênfase Sutil, Ênfase, Ênfase Intensa e Forte; a galeria acende o estilo do texto do cursor; envie para o Outlook e compare com o Word;
    - Formatar Texto → Texto sem Formatação: a pergunta aparece; ao continuar, a formatação sai e o grupo Formato mostra "Formatação desativada"; um Ctrl+Z traz a formatação de volta; continue de novo e envie: a mensagem chega em texto puro.
30. **Barra de menus**:
    - numa instalação nova, a mensagem abre sem a barra de menus; o Alt mostra os menus (Arquivo, Editar...) e o Esc ou outro Alt escondem;
    - no menu ⋯ da faixa, marque Mostrar a barra de menus: a barra aparece; abra outra mensagem: ela já abre com a barra; desmarque de novo;
    - pelo próprio Thunderbird (Alt → clique com o botão direito na barra → Barra de Menus), mostre a barra de novo: a opção da faixa acompanha;
    - Restaurar os padrões nas Opções da Faixa: a barra volta a ficar oculta.
31. **Visualização Dinâmica**:
    - selecione uma palavra e passe o mouse na lista de fontes, na de tamanhos, nas cores da fonte (e em Automático), nas do realce (e em Sem Cor) e nos estilos, na galeria da faixa e em Todos os estilos: o texto muda na hora, com um cinza no lugar da seleção; tirando o mouse (ou com Esc), volta como era;
    - com o cursor numa palavra, a prévia pega a palavra; nos estilos de parágrafo, o parágrafo inteiro;
    - depois de passar o mouse em várias opções, Ctrl+Z desfaz a última edição de verdade e Ctrl+Y refaz; o clique numa opção aplica com um Ctrl+Z;
    - com a prévia na tela, digite uma letra: ela substitui a seleção de verdade, sem a prévia;
    - numa mensagem longa (dezenas de páginas), selecione tudo e passe o mouse nas fontes: a prévia não trava a janela;
    - feche a mensagem depois de só passar o mouse (sem clicar): o Thunderbird não pergunta se quer salvar;
    - com o teclado japonês ou chinês (IME), durante a composição de uma palavra, não há prévia;
    - nas Opções da Faixa, desligue Habilitar Visualização Dinâmica: com a mensagem aberta, a prévia para de aparecer.
32. **Confirmações de entrega e de leitura** (aba Mensagem → Controle):
    - ligue as duas pelos botões e abra o menu Opções do Thunderbird (Alt → Opções): Confirmação de leitura e Notificação de status da entrega estão marcadas; desmarque uma lá e o botão apaga;
    - numa conta que sempre pede confirmação de leitura (Configurações da conta → Confirmação de leitura → Personalizar → Ao enviar mensagens, sempre solicitar confirmação de leitura), a mensagem nova abre com o botão aceso; trocando no De: para uma conta que não pede, ele apaga;
    - envie para uma caixa Outlook/Exchange: chega o aviso de entrega (quando o servidor manda) e o Outlook de quem recebe pergunta se quer enviar a confirmação de leitura;
    - grave um rascunho com as duas, feche e abra de novo: os botões continuam acesos.
33. **Acompanhamento** (aba Mensagem → Marcas):
    - envie com o botão Acompanhamento aceso (Sinalizar para Mim): a cópia em Enviados fica com a estrela, também numa conta IMAP depois de abrir a pasta Enviados (e em outro computador, pelo servidor); tire a estrela: ela não volta;
    - com Opções → Enviar uma cópia para (uma pasta qualquer), as duas cópias ficam com a estrela;
    - envie para você mesmo (no Para ou no Cco) com Sinalizar para Mim: a cópia em Enviados fica com estrela, a que chega na Entrada não;
    - com Enviar mais tarde (Ctrl+Shift+Enter), a estrela entra quando a Saída for enviada, mesmo depois de fechar e abrir o Thunderbird;
    - Acompanhamento ▾ → Sinalizar para os Destinatários e envie para uma caixa Outlook/Exchange: no Outlook de quem recebe, a mensagem chega sinalizada, com o texto "Acompanhar";
    - grave um rascunho com o Acompanhamento ligado (para mim e para os destinatários), feche e abra de novo pela pasta Rascunhos: o botão continua aceso e o menu mostra os dois marcados; envie: a estrela entra e o Outlook mostra o sinalizador;
    - Limpar Sinalizador apaga o botão e tira os dois.

## Atalhos

Há dois perfis:

- `thunderbird-office` (padrão): os atalhos do Office que não brigam com o Thunderbird. Onde há conflito, **o Thunderbird fica com a tecla**, como foi decidido. Exemplos: Ctrl+Shift+C mostra o Cc e Ctrl+Shift+V cola sem formatação.
- `office-ptbr`: para quem tem o hábito do Office em português, com Ctrl+N negrito, Ctrl+S sublinhado, Ctrl+B salvar, Ctrl+Q/Ctrl+G alinhar e Ctrl+O nova mensagem. Esse perfil troca teclas que o Thunderbird já usa, então só deve ser ligado depois de confirmar com os usuários.

O pincel usa **Ctrl+Alt+C** (copiar) e **Ctrl+Alt+V** (colar formatação), os mesmos do Google Docs, porque os do Office são do Thunderbird. Os títulos usam Ctrl+Alt+1/2/3, como no Word.

**Ctrl+K** no Para, no Cc ou no Cco verifica os nomes, como no Outlook. No corpo da mensagem, Ctrl+K continua inserindo link, como no Thunderbird (e no Outlook).

Na própria faixa, pelo teclado, como no Office:

- **F6** (e Shift+F6, ou Ctrl+Tab) passa pela faixa entre as áreas da janela do Thunderbird e para na aba escolhida. A faixa também é uma parada só do Tab, antes do Enviar.
- Na linha das abas, **← →** andam e trocam de aba (Arquivo e a barra de acesso rápido incluídos); **↓** entra nos comandos da aba ou abre o menu Arquivo.
- Nos comandos, **← →** seguem a ordem da faixa e **↑ ↓** vão para o comando de cima ou de baixo. **Enter** ou **Espaço** executam no lugar onde você estava (corpo, Para ou Assunto) e o foco volta para lá.
- Nas grades de Tabela, Emoji e Símbolo, as setas andam pela grade e **Enter** insere.
- Nas caixas Fonte e Tamanho, as setas continuam andando pela faixa até você digitar; **Alt+↓** abre a lista.
- **Esc** volta um nível: do menu para o botão, dos comandos para a aba, da aba para onde você estava.

O **AltGr** (Alt da direita) sempre digita o caractere do teclado.

- **Pincel**: Ctrl+Alt+C e Ctrl+Alt+V valem com o **Ctrl e o Alt da esquerda**, mesmo onde o Windows transformaria a combinação num caractere (₢ no ABNT2, © no US-Internacional).
- **Títulos**: Ctrl+Alt+1/2/3 cedem ao caractere onde a combinação digita alguma coisa (¹ ² ³ no ABNT2), porque m² e cm³ são comuns. Nesses teclados, os títulos saem pela galeria de estilos.
- **macOS**: os atalhos Ctrl+Alt viram Cmd+Option.

## Limitações conhecidas

- **Barra principal oculta**: junto com ela somem os botões de criptografia (OpenPGP e S/MIME) e os botões de outros complementos. Quem precisa deles liga a barra em ⋯ → **Mostrar a barra do Thunderbird**, ou a política usa `"ocultarBarraThunderbird": false`.
- **Conflitos de atalho**: ficam com o Thunderbird. O relatório de diagnóstico lista todos, com o que cada tecla faz. O F1 continua abrindo a ajuda do Thunderbird; a da faixa fica na aba Ajuda.
- **Ctrl+Alt+C e Ctrl+Alt+V com o Alt da esquerda** não digitam mais ₢ nem ©. O AltGr continua digitando.
  - Ferramentas de acesso remoto ou de remapeamento que mandam o AltGr como Ctrl+Alt da esquerda também acionam o pincel.
  - Os títulos não são afetados.
- **Conteúdo alheio**: citações, mensagens encaminhadas e a assinatura ficam como vieram quando a seleção também pega o texto do autor (Ctrl+A e depois Limpar Toda a Formatação, pincel arrastado por cima). Uma seleção só dentro da citação é tratada como escolha do usuário e recebe a formatação de caractere. Estilos e conversão de parágrafo nunca mexem nesses trechos.
- **Normalização no envio**: margem 0 e fonte explícitas em cada bloco, para o Gmail e o Outlook mostrarem o que o usuário viu. Ela só é aplicada no envio de verdade; rascunhos e modelos são gravados como estão.
  - Texto solto direto no corpo, fora de qualquer parágrafo (rascunhos antigos, por exemplo), sai dentro de um `<span>` com a fonte padrão.
  - Se o envio falhar ou for barrado, o corpo e o cursor voltam ao que eram.
  - Citações, mensagens encaminhadas e `<pre>` não são mexidos. Da assinatura, só o contêiner recebe a fonte padrão.
- **Durante o envio** a faixa e o pincel ficam desativados, como os botões do Thunderbird.
- **Delete nas sugestões** apaga o endereço dos **Endereços coletados**, a lista que o Thunderbird monta com quem já recebeu mensagens, equivalente à lista de preenchimento automático do Outlook.
  - Contatos de outros catálogos (Pessoal, CardDAV, LDAP) nunca são apagados por aqui; a faixa avisa em qual catálogo o endereço está.
  - Não tem desfazer, como no Outlook. Se você escrever de novo para o endereço, o Thunderbird volta a coletá-lo.
- **O que vem na próxima entrega da fase 2**: as abas Opções e Revisão, as janelas Fonte, Parágrafo e Propriedades, e os comandos que aparecem na faixa desativados, com a dica "Previsto para a fase 2": Lista de Vários Níveis, Classificar, Sombreamento, Bordas, Alterar Estilos, Selecionar Texto com Formatação Semelhante e Mesclar Formatação.
- **Tabela**: é a "Grade da Tabela" do Word (largura toda, bordas finas pretas, colunas iguais). Não há galeria de estilos de tabela, Desenhar Tabela, Converter Texto em Tabela nem Tabelas Rápidas. Inserir Tabela… e Propriedades da Tabela… são as janelas do Thunderbird, e a tabela vai para o Outlook como HTML comum.
- **Anexar Mensagem** lista as 500 mensagens mais novas da pasta; a pesquisa (assunto e remetente) procura entre as 50 000 mais novas. Pasta IMAP que nunca foi aberta, ou sem índice, avisa para abri-la antes na janela principal. A mensagem vai como `.eml` (message/rfc822), como no "Encaminhar como anexo" do Thunderbird.
- **Outros Cartões de Visita** anexa o vCard (`.vcf`) de cada contato escolhido; listas de distribuição não entram. Os arquivos são criados numa pasta temporária própria e apagados quando a mensagem fecha.
- **Emoji**: a grade tem 50 emoji em três grupos (carinhas, gestos, símbolos e objetos); os outros saem do painel do sistema (tecla do Windows + . no Windows, Control + Command + Espaço no macOS). A cor e a forma dependem da fonte de emoji do sistema de quem recebe.
- **Data e Hora** entra como texto; não há "Atualizar automaticamente".
- **Partes Rápidas**: sem categorias, sem o Organizador de Blocos de Construção e sem AutoTexto (F3). A galeria mostra o nome e o começo do texto de cada parte. Imagem `https` numa parte libera o conteúdo remoto daquela mensagem, como nas assinaturas.
- **Texto sem Formatação**: como no Outlook, voltar para HTML não traz a formatação de volta; só o Ctrl+Z logo depois traz. Listas, citações, tabelas, links e imagens ficam no corpo até o envio, quando o Thunderbird os converte em texto.
- **Assinaturas só em HTML**: numa mensagem em texto sem formatação, fica a assinatura do Thunderbird. Rascunhos, modelos e "editar como nova" abrem como foram salvos; trocar a conta no De: de um rascunho troca a assinatura (a de respostas, se o rascunho responde a uma mensagem).
- **Assinatura do Thunderbird**: a faixa não mexe nas Configurações da conta. Numa conta com padrão da faixa, a assinatura do Thunderbird é trocada pela da faixa ao abrir a mensagem. Quem desiste da faixa volta a ter a do Thunderbird.
- **Menu Assinatura ▾** troca a última assinatura do corpo (como no Outlook). Sem assinatura no corpo, a escolhida entra depois do parágrafo do cursor.
- **Verificar Nomes** procura nos catálogos com a mesma busca do autocompletar do Thunderbird. Catálogos LDAP só são consultados com texto digitado, e cada um tem até 5 s para responder. Lista de distribuição entra pelo nome.
  - Enquanto a verificação espera os catálogos, o envio espera também (Enviar, Ctrl+Enter): o texto digitado sai da caixa durante a verificação, para o autocompletar do Thunderbird não transformar a sugestão dele em destinatário quando a janela de escolha abre.
  - O ponto e vírgula sempre separa nomes, como no Outlook. A vírgula também, exceto em "Sobrenome, Nome <e-mail>", que o Thunderbird lê como um endereço só.
- **Imagem de fora (https) numa assinatura ou Parte Rápida**: nessa mensagem, a composição passa a carregar conteúdo remoto, como o Thunderbird faz quando o usuário cola uma imagem. O que veio na citação continua bloqueado. Para não depender disso, use a imagem embutida (`data:`), que é o que as páginas Assinaturas e Partes Rápidas gravam.
- **Campos da assinatura numa tabela**: a linha sai quando os campos dela ficam vazios, mas um rótulo numa célula separada ("Cel.:" numa coluna e {celular} na outra) fica. Ponha rótulo e campo na mesma célula.
- **Visualização Dinâmica**:
  - vale para fontes, tamanhos, cores da fonte e do realce e estilos (os mesmos comandos e o mesmo alvo do clique). Negrito, marcadores, espaçamento e os outros comandos não têm prévia;
  - durante a prévia, a seleção sai da tela e um cinza translúcido marca o trecho, porque a cor de seleção do sistema cobriria a cor e o realce da prévia; tirando o mouse, a seleção volta;
  - Automático e Sem Cor mostram o texto com a cor e o fundo do parágrafo, que é o que o clique deixa na maioria dos casos;
  - num parágrafo com quebras de linha (Shift+Enter), a prévia de um estilo de parágrafo mostra o parágrafo inteiro; o clique muda só as linhas da seleção;
  - seleções muito grandes (mais de 500 trechos de texto ou 100 parágrafos) não têm prévia: o clique aplica normalmente;
  - a prévia não usa o editor: são marcações provisórias no documento, tiradas antes de qualquer tecla (menos as setas, que andam pela faixa) ou clique, de qualquer comando da faixa e do começo do envio e das gravações (inclusive a automática de rascunho), antes de o Thunderbird ou outro complemento ler o corpo.
- **Dicas de tecla do Office** (as letras que aparecem com Alt) não existem: o Alt continua abrindo a barra de menus do Thunderbird (mesmo oculta pela faixa). As KeyTips saíram do escopo junto com o resto da fase 3 (faixa responsiva completa, Ler em Voz Alta e Verificar Acessibilidade).
- **Desfazer e Refazer** da barra de acesso rápido, com o foco no Para ou no Assunto, desfazem o que foi digitado no campo, pelo Thunderbird.
- **Barra de menus**: no macOS os menus ficam na barra do sistema, e a opção não aparece. A faixa não grava nada nas preferências de barras do Thunderbird: sem a faixa (desligada ou desinstalada), a barra volta a ser como o Thunderbird guardou. Quem já tinha escolhido mostrar a barra numa versão anterior continua com ela.
- **Idiomas novos**: os perfis de atalho continuam dois (Thunderbird + Office, com os atalhos do Office em inglês, e Office em português). Não há perfil com os atalhos do Office em espanhol, italiano, alemão ou francês (Ctrl+N negrita no Office em espanhol, Strg+Umschalt+F fett no alemão).
- **Confirmações de entrega e de leitura**: dependem de quem recebe. O aviso de entrega só vem se os servidores no caminho aceitam o pedido (DSN), e a confirmação de leitura, se quem recebe aceita mandá-la (o Thunderbird e o Outlook perguntam; o Gmail não manda). Os avisos chegam como mensagens comuns; não há o painel Controle do Outlook, que junta as respostas na mensagem enviada.
- **Acompanhamento**:
  - sem data de conclusão nem lembrete (Hoje, Amanhã, Esta Semana, Adicionar Lembrete...): a estrela do Thunderbird não tem data;
  - Sinalizar para Mim marca as cópias que o Thunderbird grava: a de Enviados (ou da pasta da mensagem respondida, se a conta pede isso) e a de Opções → Enviar uma cópia para. Com a cópia desligada nas Configurações da conta (Cópias e pastas), só a do menu Opções, se houver; sem nenhuma, não há onde pôr a estrela. A faixa espera a cópia aparecer por uma semana (com Enviar mais tarde, 30 dias) e põe a estrela uma vez em cada pasta: tirada depois, ela não volta;
  - Sinalizar para os Destinatários usa o cabeçalho `X-Message-Flag`, que o Outlook mostra como sinalizador, com o texto no idioma da faixa de quem envia. O Thunderbird e o Gmail de quem recebe não mostram nada;
  - o rascunho guarda o Acompanhamento no perfil deste Thunderbird (pelo Message-ID do rascunho): aberto em outro computador, ele volta sem o Acompanhamento. Modelos não guardam.
- **Início do Thunderbird**: se a página de eventos do complemento ainda não subiu, os comandos que dependem dela (prioridade, formato, Ajuda, Salvar Seleção na Galeria) esperam até 60 s na fila e são entregues depois.

## Estrutura

| Caminho | O que é |
|---|---|
| `manifest.json`, `_locales/` | Manifesto MV3 e o nome e a descrição nos seis idiomas |
| `background.js`, `lib/config.js` | Página de eventos: configuração (política > usuário > padrão), comandos que usam a API compose (prioridade, formato de envio), Salvar Seleção na Galeria, Ajuda e Contatar o Suporte |
| `experiments/faixa/implementation.js` | API do experiment, controlador de cada janela de composição, autoteste e fila de eventos |
| `experiments/faixa/host.js` | Tudo o que depende de `messengercompose.xhtml` no TB 153: montagem, Enviar, comandos nativos, envio, anexos (mensagens e cartões de visita), pastas e levantamento de teclas |
| `experiments/faixa/engine.js` | Motor de edição pelo editor do Gecko: um comando = um Ctrl+Z; pincel, tamanhos em pt, estilos, tabela, Texto sem Formatação, Visualização Dinâmica (fora do editor), normalização do envio |
| `experiments/faixa/ui.js` | Interface da faixa (abas, grupos que recolhem, menus, grades de tabela, emoji e símbolos, dicas) e leitura dos atalhos |
| `experiments/faixa/names.js`, `dialogs.js` | Verificar Nomes e Selecionar Nomes; as janelas da faixa (escolha de nomes, Selecionar Nomes, Anexar Mensagem, cartões de visita, Data e Hora, Salvar Seleção, Contatar o Suporte, Sobre) |
| `experiments/faixa/signatures.js`, `quickparts.js`, `sanitize.js` | Assinaturas (padrão por conta, campos, troca de conta, menu), Partes Rápidas (galeria, inserção, Salvar Seleção) e a limpeza do HTML delas; também usados pelas páginas Assinaturas e Partes Rápidas |
| `experiments/faixa/ribbon.css`, `icons.js` | Visual da faixa e ícones (Lucide, licença ISC em `LICENSES/`) |
| `ribbon/definition.json` | Definição declarativa: comandos, abas, grupos, menus, estilos, emoji e símbolos, perfis de atalho e a tabela de referência do Office. Textos em pt-BR |
| `ribbon/locales/*.json` | Inglês (`en-US`), espanhol (`es`), italiano (`it`), alemão (`de`) e francês (`fr`): por cima da definição, os textos do código (seção `strings`) e os nomes das teclas (`keyNames`) |
| `options/` | Opções da Faixa (`opcoes.*`), Assinaturas e Partes Rápidas (`assinaturas.*`, `partes.html`), Ajuda (`ajuda.*`), diagnóstico (`diagnostico.*`) e a tradução delas (`pagina.js`) |
| `tools/build.py` | Empacota o `.xpi` (e o `updates.json`) |
| `tools/check_i18n.py` | Confere se todo texto em pt-BR tem tradução, com as mesmas variáveis, e se nenhuma tradução ficou apontando para o lugar errado |
| `tools/gen_icons.py` | Gera `icons.js` |
| `test/harness/` | Simulador com o controlador real e um host simulado; `background.html` roda o `background.js` com uma API simulada |

## Testes no simulador

```
pip install playwright --break-system-packages   # se ainda não tiver
python3 test/harness/run_tests.py /tmp/faixa-capturas            # Chromium
python3 test/harness/run_tests.py /tmp/faixa-capturas --gecko    # Firefox: o editor do Gecko, como no Thunderbird
python3 test/harness/diag_test.py /tmp/faixa-capturas            # páginas do complemento e background
python3 test/harness/diag_test.py /tmp/faixa-capturas --gecko    # as mesmas páginas no Firefox
python3 tools/check_i18n.py                                      # traduções
```

O `run_tests.py` roda o `implementation.js`, a `ui.js` e o `engine.js` de verdade, trocando só o host (`sim-host.js`), que imita o que o Thunderbird faz (a divisão do parágrafo em volta de uma tabela, os comandos de tabela, as pastas e os anexos). O `diag_test.py` abre as Opções da Faixa, as Assinaturas, as Partes Rápidas (com outra janela gravando ao mesmo tempo), a Ajuda e o diagnóstico, e roda o `background.js` com os comandos da faixa. As capturas de tela ficam na pasta indicada. Com `--gecko`, o editor é o mesmo do Thunderbird (espaços, `&nbsp;`, `insertText`), o que pega erros que o Chromium esconde.

Nenhum dos dois é o Thunderbird. O que só existe nele fica com o autoteste e com a conferência manual:

- eventos de teclado com AltGr;
- `ComposeProcessDone`;
- o `formatBlock` e o desfazer do editor;
- as janelas e os comandos nativos (Inserir Tabela, Imagem, Link, Caracteres), as pastas IMAP e a pasta temporária dos cartões de visita.

Diferença do Chromium que os testes descontam: o `removeFormat` deixa `style=""` nos blocos e empurra a fonte do `<body>` para os blocos vizinhos do trecho limpo.

## Versões

- **0.7.1**: barra de menus oculta por padrão; a aba Ajuda perde Contatar o Suporte e Diagnóstico da Faixa (o diagnóstico continua no ⋯, no Sobre e nas Opções da Faixa).
- **0.7.0**: confirmações de entrega e de leitura e o Acompanhamento.
  - Grupo Controle na aba Mensagem: Solicitar Confirmação de Entrega e Solicitar Confirmação de Leitura, as mesmas do menu Opções do Thunderbird, com o padrão da conta.
  - Acompanhamento ▾ na aba Mensagem (antes desativado, "Previsto para a fase 2"): Sinalizar para Mim, com a estrela na cópia enviada (também com Enviar mais tarde e depois de reiniciar), Sinalizar para os Destinatários (`X-Message-Flag`, para o Outlook) e Limpar Sinalizador; os rascunhos guardam o que foi escolhido.
  - Dois itens novos no autoteste; textos nos seis idiomas.
  - Botões grandes com menu: a seta fica junto do rótulo e não cobre mais o nome do grupo com a janela estreita.
- **0.6.0**: barra de menus, seis idiomas e o autoteste do Thunderbird.
  - Opção de ocultar a barra de menus da janela de mensagem (menu ⋯, Opções da Faixa e a chave `ocultarBarraMenus` na política), com o Alt para os menus, como a opção Barra de Menus do Thunderbird; item novo no autoteste.
  - Espanhol, italiano, alemão e francês, com os termos do Office, as teclas escritas como no idioma, a vírgula decimal e os campos das assinaturas no idioma ({nombre}, {ruolo}, {firma}, {téléphone}); as páginas do complemento também.
  - Autoteste: na 0.5.0, no Thunderbird, Tabela, Inserir, Partes Rápidas e Estilos falhavam porque o Thunderbird levava o foco para a linha Cc (aberta pelo Selecionar Nomes); agora o foco volta ao corpo antes deles.
  - Rótulos longos dos botões grandes quebram nos espaços e só palavras longas recebem hífen, também com a janela estreita.

- **0.5.0**: Visualização Dinâmica (da fase 3), como no Office.
  - Com o mouse ou o foco do teclado nas fontes, nos tamanhos, nas cores da fonte e do realce e nos estilos, o texto mostra o resultado antes do clique.
  - Fora do desfazer: o corpo, a seleção, o Desfazer e o Refazer voltam exatamente como estavam, e a mensagem não conta como alterada.
  - Opção Habilitar Visualização Dinâmica nas Opções da Faixa e a chave `visualizacaoDinamica` na política; item novo no autoteste.
- **0.4.0**: fase 2, primeira entrega.
  - Aba Inserir: Anexar Mensagem, Cartão de Visita (o seu e o de contatos), Tabela com grade e os comandos de linhas, colunas e células, Imagens, Link, Indicador, Data e Hora, Emoji, Símbolo e Linha Horizontal.
  - Partes Rápidas: galeria na aba Inserir, Salvar Seleção na Galeria de Partes Rápidas, página Partes Rápidas e partes da organização por política.
  - Aba Ajuda: Ajuda, Contatar o Suporte, Atalhos de Teclado e Sobre, com o contato do suporte por política; página de ajuda da faixa.
  - Estilos Subtítulo, Ênfase Sutil, Ênfase, Ênfase Intensa e Forte; Texto sem Formatação tira a formatação do corpo, como no Outlook.
  - Autoteste com tabela, inserção no cursor, Partes Rápidas, estilos e Texto sem Formatação.
- **0.3.0**: fase 1, segunda entrega.
  - Verificar Nomes (Ctrl+K no Para, Cc e Cco), com a escolha entre nomes parecidos e o desconhecido em vermelho.
  - Selecionar Nomes no Catálogo de Endereços: pesquisa em todos os catálogos, seleção múltipla, Para, Cc e Cco.
  - Assinaturas como no Outlook: várias, padrão por conta para mensagens novas e respostas, menu Assinatura ▾, página Assinaturas com editor, campos do cartão de visita, importação das do Thunderbird e assinaturas e padrões por política.
  - Autoteste com Verificar Nomes, Selecionar Nomes e assinatura; diagnóstico mostra Ctrl+K no Para e no corpo separadamente.
- **0.2.0**: fase 1, primeira entrega.
  - Menu Arquivo e barra de acesso rápido com Salvar; Maiúsculas e Minúsculas; espaço antes e depois do parágrafo; menu Anexar Arquivo com Filelink, cartão de visita e chave OpenPGP.
  - Formatação desativada com o foco no Para ou no Assunto, como no Outlook.
  - Teclado: F6, setas, Enter e Esc na faixa; faixa recolhida que abre por cima da mensagem; alto contraste.
  - Português e inglês; página Opções da Faixa; diagnóstico traduzido.
  - Normalização do envio: um parágrafo com espaço antes sai com 0 explícito do outro lado.
- **0.1.2**: Delete numa sugestão destacada do autocompletar de destinatários tira o endereço dos Endereços coletados, como no Outlook. No Thunderbird puro a tecla não tira a sugestão: a lista dele não aceita remoção.
- **0.1.1**
  - Parágrafos também com "Usar formato Parágrafo" desligado no Thunderbird. Na primeira execução real (Thunderbird 156.0.1, Windows), essa opção desligada derrubou 3 dos 18 itens do autoteste: Enter, ¶ e normalização.
  - Texto solto no corpo sai com a fonte padrão.
  - O diagnóstico mostra as preferências de parágrafo do Thunderbird.
- **0.1.0**: primeira prova de conceito.
