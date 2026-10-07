# Histórico de versões

O `.xpi` de cada versão fica nas [Releases](https://github.com/vagner-dias/ThunderbirdComposeBar/releases). A seção de cada versão vira as notas da release (ver [Publicar uma versão](README.md#publicar-uma-versão)).

## 0.7.2

- Menu Arquivo: sai o item **Propriedades…**, que aparecia desativado, com "(fase 2)" no rótulo. A janela Propriedades continua prevista para a fase 2.
- O `.xpi` de cada versão passa a ser publicado nas Releases do GitHub, pelo workflow Release, quando a versão nova chega ao `main`.

## 0.7.1

Barra de menus oculta por padrão; a aba Ajuda perde Contatar o Suporte e Diagnóstico da Faixa (o diagnóstico continua no ⋯, no Sobre e nas Opções da Faixa).

## 0.7.0

Confirmações de entrega e de leitura e o Acompanhamento.

- Grupo Controle na aba Mensagem: Solicitar Confirmação de Entrega e Solicitar Confirmação de Leitura, as mesmas do menu Opções do Thunderbird, com o padrão da conta.
- Acompanhamento ▾ na aba Mensagem (antes desativado, "Previsto para a fase 2"): Sinalizar para Mim, com a estrela na cópia enviada (também com Enviar mais tarde e depois de reiniciar), Sinalizar para os Destinatários (`X-Message-Flag`, para o Outlook) e Limpar Sinalizador; os rascunhos guardam o que foi escolhido.
- Dois itens novos no autoteste; textos nos seis idiomas.
- Botões grandes com menu: a seta fica junto do rótulo e não cobre mais o nome do grupo com a janela estreita.

## 0.6.0

Barra de menus, seis idiomas e o autoteste do Thunderbird.

- Opção de ocultar a barra de menus da janela de mensagem (menu ⋯, Opções da Faixa e a chave `ocultarBarraMenus` na política), com o Alt para os menus, como a opção Barra de Menus do Thunderbird; item novo no autoteste.
- Espanhol, italiano, alemão e francês, com os termos do Office, as teclas escritas como no idioma, a vírgula decimal e os campos das assinaturas no idioma ({nombre}, {ruolo}, {firma}, {téléphone}); as páginas do complemento também.
- Autoteste: na 0.5.0, no Thunderbird, Tabela, Inserir, Partes Rápidas e Estilos falhavam porque o Thunderbird levava o foco para a linha Cc (aberta pelo Selecionar Nomes); agora o foco volta ao corpo antes deles.
- Rótulos longos dos botões grandes quebram nos espaços e só palavras longas recebem hífen, também com a janela estreita.

## 0.5.0

Visualização Dinâmica (da fase 3), como no Office.

- Com o mouse ou o foco do teclado nas fontes, nos tamanhos, nas cores da fonte e do realce e nos estilos, o texto mostra o resultado antes do clique.
- Fora do desfazer: o corpo, a seleção, o Desfazer e o Refazer voltam exatamente como estavam, e a mensagem não conta como alterada.
- Opção Habilitar Visualização Dinâmica nas Opções da Faixa e a chave `visualizacaoDinamica` na política; item novo no autoteste.

## 0.4.0

Fase 2, primeira entrega.

- Aba Inserir: Anexar Mensagem, Cartão de Visita (o seu e o de contatos), Tabela com grade e os comandos de linhas, colunas e células, Imagens, Link, Indicador, Data e Hora, Emoji, Símbolo e Linha Horizontal.
- Partes Rápidas: galeria na aba Inserir, Salvar Seleção na Galeria de Partes Rápidas, página Partes Rápidas e partes da organização por política.
- Aba Ajuda: Ajuda, Contatar o Suporte, Atalhos de Teclado e Sobre, com o contato do suporte por política; página de ajuda da faixa.
- Estilos Subtítulo, Ênfase Sutil, Ênfase, Ênfase Intensa e Forte; Texto sem Formatação tira a formatação do corpo, como no Outlook.
- Autoteste com tabela, inserção no cursor, Partes Rápidas, estilos e Texto sem Formatação.

## 0.3.0

Fase 1, segunda entrega.

- Verificar Nomes (Ctrl+K no Para, Cc e Cco), com a escolha entre nomes parecidos e o desconhecido em vermelho.
- Selecionar Nomes no Catálogo de Endereços: pesquisa em todos os catálogos, seleção múltipla, Para, Cc e Cco.
- Assinaturas como no Outlook: várias, padrão por conta para mensagens novas e respostas, menu Assinatura ▾, página Assinaturas com editor, campos do cartão de visita, importação das do Thunderbird e assinaturas e padrões por política.
- Autoteste com Verificar Nomes, Selecionar Nomes e assinatura; diagnóstico mostra Ctrl+K no Para e no corpo separadamente.

## 0.2.0

Fase 1, primeira entrega.

- Menu Arquivo e barra de acesso rápido com Salvar; Maiúsculas e Minúsculas; espaço antes e depois do parágrafo; menu Anexar Arquivo com Filelink, cartão de visita e chave OpenPGP.
- Formatação desativada com o foco no Para ou no Assunto, como no Outlook.
- Teclado: F6, setas, Enter e Esc na faixa; faixa recolhida que abre por cima da mensagem; alto contraste.
- Português e inglês; página Opções da Faixa; diagnóstico traduzido.
- Normalização do envio: um parágrafo com espaço antes sai com 0 explícito do outro lado.

## 0.1.2

Delete numa sugestão destacada do autocompletar de destinatários tira o endereço dos Endereços coletados, como no Outlook. No Thunderbird puro a tecla não tira a sugestão: a lista dele não aceita remoção.

## 0.1.1

- Parágrafos também com "Usar formato Parágrafo" desligado no Thunderbird. Na primeira execução real (Thunderbird 156.0.1, Windows), essa opção desligada derrubou 3 dos 18 itens do autoteste: Enter, ¶ e normalização.
- Texto solto no corpo sai com a fonte padrão.
- O diagnóstico mostra as preferências de parágrafo do Thunderbird.

## 0.1.0

Primeira prova de conceito.
