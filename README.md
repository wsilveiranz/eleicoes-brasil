# Brasil em votos — comparação dos turnos de 2026

Painel independente em português para comparar os resultados finais da eleição
presidencial de 2026. React, TypeScript e Vite, sem backend, banco de dados,
credenciais ou consultas periódicas ao TSE por visitante.

**Site:** https://wsilveiranz.github.io/eleicoes-brasil/

## Leitura da comparação

As mesmas localidades estão disponíveis nos dois turnos:

- **Total geral:** Brasil e exterior, conforme a totalização oficial.
- **Brasil:** soma dos 26 estados e DF, com detalhamento por UF e município.
- **Exterior:** total oficial ZZ, com detalhamento por país/território de votação.

Cada página mostra primeiro a comparação da localidade: votos válidos dos dois
turnos e sua variação, duas barras de participação percentual, barras de votos
absolutos em escala comum e tabela das candidaturas. Lula/PT usa vermelho;
Flávio Bolsonaro/PL, azul. Os demais candidatos aparecem no bloco neutro
**Outros** da barra do primeiro turno e nas tabelas, com votos e percentual do
primeiro turno. Votos do segundo turno e variações de Outros são `—`, não uma
perda fictícia de votos. Na tabela principal, Outros permanece na última linha;
os cabeçalhos ordenam os finalistas.

As barras percentuais usam **os votos válidos da própria localidade e do próprio
turno**. A linha de 50% é uma referência de participação, não progresso de apuração.
As barras absolutas compartilham a mesma escala entre os dois candidatos e turnos
na localidade selecionada.

A diferença de votos é `segundo turno − primeiro turno`. A diferença de participação
é expressa em **pontos percentuais**, calculados antes do arredondamento.
O crescimento relativo do total de votos válidos usa o primeiro turno como base.
Denominadores iguais a zero produzem `—`, não percentuais inventados.

**Mudanças agregadas não identificam como eleitores individuais mudaram seu voto.**
O painel não atribui os votos de Outros a nenhum finalista.
Brancos e nulos permanecem separados dos votos válidos.

Nas páginas Brasil/Exterior, cada estado/país mostra quatro linhas: total de votos
válidos, Lula, Flávio Bolsonaro e Outros, com votos, percentuais e variações visíveis
simultaneamente. Os filtros e a referência de ordenação afetam apenas a tabela,
nunca o resultado geral ou o endereço. A ordenação numérica usa inicialmente o
total válido e pode usar qualquer finalista sem ocultar as demais linhas.
Os nomes das localidades abrem os detalhes, incluindo os horários das fontes.
Na lista e no filtro de países, locais sem nenhum voto nos dois turnos são
omitidos. Países com votos em pelo menos um turno permanecem; brancos/nulos
também contam para essa regra. A omissão é apenas visual: não muda os totais,
os dados preservados ou os links diretos.
**Fonte, cobertura e demais votos** fica sempre no fim da localidade, depois de
mapa, tabelas e navegação municipal, recolhido por padrão. Abra a seção para
consultar brancos, nulos, seções contabilizadas e horários de cada turno.

### Mapa do segundo turno

Somente Brasil inclui um mapa das 27 UFs depois do resumo e antes da
tabela estadual. Exterior mostra apenas a tabela de países; Total geral não
mostra mapa nem tabela geográfica. Vermelho indica Lula; azul, Flávio Bolsonaro. A cor usa
somente a votação final do segundo turno de cada UF, não o primeiro turno ou
a votação nacional. Empate, ausência de votos válidos ou dados inválidos/não
finalizados ficam neutros, com motivo textual. A indicação é de candidatura
mais votada na UF, não de uma eleição estadual para presidente.

Os estados e os links alternativos de siglas abrem o detalhamento existente.
Os links alternativos têm alvos de toque maiores, inclusive para o DF.
A malha oficial [IBGE, UFs 2024](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2024/Brasil/BR_UF_2024.zip)
foi simplificada para exibição, não para precisão cartográfica. Geometria,
códigos IBGE/siglas e proveniência estão em `src\data\geography\brazil-states.json`.
O mapa é incluído no site; o navegador não consulta um serviço de mapas.

Para reproduzir a geometria, baixe o ZIP oficial acima e execute:

```powershell
python scripts\generate-state-map.py C:\caminho\BR_UF_2024.zip
```

O gerador usa somente a biblioteca padrão do Python, confere o SHA-256 fixado
da fonte, exige todas as 27 UFs e preserva separadamente códigos IBGE e siglas TSE.

## Participação e perfil eleitoral

A área **Participação e perfil eleitoral** fica separada dos resultados e tem
endereço compartilhável: `?area=estatisticas`. A navegação de volta aos resultados
preserva a última localidade selecionada.

As barras de participação comparam comparecimento e abstenção nos dois turnos,
no total Brasil + exterior e nas cinco regiões brasileiras. O denominador é o
eleitorado apto publicado na fonte, não votos válidos. Quem votou em branco ou
nulo compareceu. Eleitores em seções não instaladas ficam em um segmento separado
de participação sem informação, sem virar abstenção por suposição.
O TSE documenta 39 registros duplicados por transferência temporária no total
apto dos arquivos de resultados; preservamos as contagens publicadas, sem uma
correção regional inventada.

As duas pizzas regionais mostram a **origem dos votos de cada candidato**:
quanto dos votos de Lula ou Flávio veio de cada região, excluindo o exterior.
O seletor alterna entre turnos; cores regionais e uma tabela de votos/percentuais
permitem comparação lado a lado. Não são percentuais de preferência em cada região.

O perfil etário mede **comparecimento por idade**, não votos por candidato.
Mostra a distribuição das pessoas que compareceram, aptos, taxa de comparecimento,
participação nos presentes e, quando ambos os turnos estão completos, diferenças
absolutas e em pontos percentuais. As faixas oficiais são preservadas, incluindo
categorias desconhecidas quando presentes. Comparecimento por idade não revela
preferências individuais nem prova que uma faixa etária causou um resultado.

### Atualização automática do perfil etário

O workflow de Pages verifica diariamente, às **09:23 UTC** (agendamento
best-effort do GitHub), o
[arquivo oficial de Comparecimento e Abstenção 2026](https://dadosabertos.tse.jus.br/dataset/comparecimento-e-abstencao-2026).
Também é possível iniciar o workflow manualmente com `refresh_age` habilitado.
ETag e Last-Modified evitam transferir novamente um arquivo sem alterações.
Quando necessário, o importador baixa o ZIP com até quatro transferências de
intervalos simultâneas, verificando ETag/intervalos para não misturar versões.

O arquivo bruto é grande e não integra o site: Python agrega apenas totais por
faixa/turno, sem publicar os demais cruzamentos demográficos. O CSV BRASIL repete
as UFs e não é somado novamente. Ano, turnos, códigos das 27 UFs + exterior,
contagens e reconciliação são verificados; contagens parciais não viram comparação.
A geração etária usa um sistema/data de fonte diferente dos resultados assinados;
eventuais diferenças de totais entre fontes não são normalizadas artificialmente.

O job persiste `public\data\2026\age-turnout.json` em um commit automático e publica
o mesmo commit na mesma execução. Não depende de um novo workflow acionado pelo
commit do GITHUB_TOKEN nem de PR manual. Quando o TSE disponibilizar o segundo
turno completo, a comparação aparece automaticamente. Enquanto isso, a interface
indica publicação ausente ou cobertura incompleta, sem zeros substitutos.

Falhas preservam os últimos dados válidos e publicam o estado de erro; última
tentativa, última verificação bem-sucedida e data de geração da fonte são separadas.
A interface avisa após 72 horas sem verificação bem-sucedida. O GitHub pode atrasar
ou desativar schedules de repositórios públicos inativos; esses casos também
ficam evidentes pela data/aviso de verificação atrasada. Falhas de push ou build
aparecem no Actions e impedem publicação. O navegador nunca baixa ZIPs do TSE.

```powershell
npm run statistics:export
npm run statistics:refresh
npm run statistics:check
python -m unittest discover -s scripts -p "test_*.py"
```

`statistics:export` exige o cache assinado original e confere todos os hashes com
a captura publicada; gera `participation.json`, sem alterar o conjunto de votos.
`statistics:refresh` consulta a fonte etária HTTPS e atualiza dados/status
atomicamente; retorna erro quando a consulta/importação falha.
`statistics:check` valida os dois pequenos recursos locais, sem acesso à rede.
Não se faz consulta automática nem importação de milhares de resultados por visitante.

## Executar e verificar

Requer Node.js compatível com `engines.node` em `package.json` e npm. O navegador
deve oferecer WebCrypto em contexto seguro (HTTPS ou localhost).

```powershell
npm ci
npm run dev
```

```powershell
npm run typecheck
npm run lint
npm run test
npm run data:check
python scripts\generate-country-map.py --check
npx playwright install chromium
npm run test:e2e
npm run build
npm run preview
```

`build` inclui a checagem de tipos e gera `dist`. Os testes de navegador exercitam
o artefato de produção com os dados estáticos, incluindo alterações indevidas
em arquivos, navegação, filtros, cache por UF e disposição em telas pequenas.

## Dados estáticos e proveniência

Os dados publicados ficam em `public\data\2026\`. Um manifesto versionado descreve
o resumo e os arquivos municipais por UF, com tamanho e SHA-256. O navegador
valida os arquivos antes de apresentá-los; não usa fixtures ou resultados de outra
eleição como fallback.

O resumo reúne os dois turnos para os totais geral/Brasil/exterior e para todas
as UFs e países. Os resultados municipais são carregados apenas ao selecionar
um município: uma consulta obtém o arquivo de sua UF e o reutiliza para os demais
municípios daquele estado. Não há download de todos os resultados municipais na
entrada nem tempestade de consultas individuais por país.

O conjunto inicial contém 5.571 municípios brasileiros e 133 países/territórios
nos dois turnos. Manifesto e resumo somam aproximadamente **371 KB sem compressão**;
o maior arquivo municipal por UF tem aproximadamente **681 KB**. O conjunto
completo, incluindo a proveniência das 11.575 fontes assinadas, ocupa cerca de
**9,25 MB**, mas não é carregado inteiro na entrada.

O manifesto e a interface registram a data da importação. Cada resultado preserva
os horários da fonte, a cobertura e o status final de ambos os turnos.
**Final não significa imutável:** eventuais retificações oficiais exigem uma nova
importação revisada e publicação. O site não mistura automaticamente um retrato
estático com resultados ao vivo.

### Atualizar a captura

```powershell
npm run data:import
npm run data:check
```

A execução padrão retoma a mesma captura e reutiliza arquivos já verificados.
Para obter eventuais **retificações**, inicie uma captura com um nome novo:

```powershell
npm run data:import -- --capture correction-2026-11-01
```

Use o mesmo nome para retomar essa nova captura caso seja interrompida. Os nomes
são identificadores locais; não selecionam outra eleição nem alteram o escopo.
Revise os dados e execute as verificações antes de publicar a nova versão.

A importação consulta as fontes oficiais, verifica suas assinaturas e valida
eleição, turno, cargo, candidatos, localidade, contagens, finalização e cobertura.
Ela reutiliza capturas bem-sucedidas de um cache local para permitir retomada,
limita a concorrência e respeita falhas e intervalos solicitados pela fonte.
O cache de captura não integra o site publicado.

Antes de publicar, é necessário verificar todos os municípios/localidades e
reconciliar seus totais com UFs, exterior, países e total geral. Ausência de
dados não é zero. Uma importação incompleta não substitui o conjunto publicado.
Revise o manifesto, a proveniência e os relatórios de verificação junto com os
arquivos gerados. `data:check` e o CI validam os arquivos locais sem baixar
novamente os resultados oficiais.

### Fontes oficiais e confiança

Aplicativo oficial: https://resultados.tse.jus.br/oficial/app/index.html

Descoberta das eleições:
https://resultados.tse.jus.br/oficial/comum/config/ele-c.jws

Os identificadores verificados para presidente em 2026 são **6257**, primeiro
turno de 04/10, e **6258**, segundo turno de 25/10, ciclo `ele2026`, cargo `0001`.
Os arquivos oficiais são JWS assinados, não JSON que possa ser aceito apenas
decodificando base64.

`src\data\tse\trust.ts` fixa a chave pública Ed25519 revisada no aplicativo
oficial, build `26.10.17 (7216371)`. Essa chave **não é segredo**.
Chave/algoritmo desconhecido ou assinatura inválida bloqueiam a importação.
O build inspecionado não anuncia endereço público de rotação automática:
revise o aplicativo oficial antes de atualizar a chave; nunca aceite material
de confiança fornecido pelo próprio token.

Votos válidos usam `v.vv`, não `v.tv` nem um denominador recalculado para ocultar
divergências. Seções contabilizadas usam `s.st`, e a finalização usa o indicador
oficial `tf`, não apenas um percentual visual de 100%.
Os contratos e as capturas de testes anteriores continuam documentados em
`tests\fixtures\official-contract.json`; fixtures nunca são dados de produção.

## Mapeamento dos países

Fonte:
https://www.tre-df.jus.br/eleicoes/mesas-receptoras-de-votos-no-exterior-2026

O mapeamento em `src\data\geography\countries.json` deriva das planilhas oficiais
do TRE-DF, com proveniência por linha. A cobertura é conferida contra o inventário
dos dois turnos: 186 localidades em 133 países/territórios.

```powershell
python scripts\generate-country-map.py --check
```

O gerador usa apenas a biblioteca padrão do Python e verifica os hashes das
fontes preservadas em `tests\fixtures`. Não deduza países por nomes de cidades.
Os rótulos são os publicados pelo TRE-DF, não uma classificação ISO inferida:
Caiena aparece como Guiana Francesa e Saint Georges de Loyapock como França.
O recorte indica o **local de votação**, não residência ou cidadania do eleitor.

## Publicação

O workflow `.github\workflows\pages.yml` valida os dados, código e build, e publica
o conteúdo de `dist` no GitHub Pages a cada push em `main`. Não importa novamente
milhares de arquivos do TSE durante builds comuns.

O site é portátil para qualquer hospedagem estática HTTPS. `vite.config.ts`
usa `base: './'`; mantenha a estrutura dos arquivos e a barra final do diretório.
A navegação usa parâmetros de consulta e não requer rewrites:

```text
?visao=brasil
?visao=brasil&uf=sp&municipio=71072
?visao=exterior&pais=portugal
```

Verifique abertura direta, recarga, voltar/avançar e carregamento dos arquivos
de dados no subcaminho real antes de divulgar uma nova publicação.
