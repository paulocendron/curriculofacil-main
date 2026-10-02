/* ============================================================
   app.js — Lógica principal do CurrículoFácil
   Responsável por:
     • Navegar entre as etapas do formulário (wizard)
     • Adicionar / remover blocos de experiência e formação
     • Coletar todos os dados preenchidos
     • Exibir a prévia do currículo em um modal
     • Gerar e baixar o currículo em PDF via jsPDF
   ============================================================ */


/* ------------------------------------------------------------
   ESTADO GLOBAL
   Contadores e variáveis compartilhadas por todo o script
   ------------------------------------------------------------ */

let expCount   = 0;        // quantidade de blocos de experiência adicionados
let eduCount   = 0;        // quantidade de blocos de formação adicionados
let currentStep = 1;       // etapa atualmente visível no wizard (1 a 4)
const TOTAL_STEPS = 4;     // número total de etapas do formulário

// Abreviações dos meses em português, usadas para formatar o campo "month"
const MONTHS_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];


/* ------------------------------------------------------------
   FONTE ROBOTO PARA O PDF
   A Roboto é carregada do CDN do Google Fonts em segundo plano.
   Se o carregamento falhar (sem internet, CORS etc.), o PDF
   utiliza Helvetica automaticamente como alternativa.
   ------------------------------------------------------------ */

let _robotoNormal = null;  // base64 do arquivo TTF da Roboto Regular
let _robotoBold   = null;  // base64 do arquivo TTF da Roboto Bold

/**
 * Baixa os arquivos TTF da Roboto do CDN do Google e os converte
 * para base64, armazenando-os nas variáveis acima.
 * É chamada uma vez ao carregar a página para que a fonte já esteja
 * pronta quando o usuário clicar em "Baixar PDF".
 */
async function preloadRoboto() {
  try {
    const [r1, r2] = await Promise.all([
      fetch('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'),       // Regular
      fetch('https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc4AMP6lQ.ttf'), // Bold
    ]);

    // Garante que as respostas são válidas antes de armazenar
    if (!r1.ok || !r2.ok) return;

    _robotoNormal = bufToB64(await r1.arrayBuffer());
    _robotoBold   = bufToB64(await r2.arrayBuffer());
  } catch (_) {
    // Silencioso: sem internet ou bloqueio por CORS → usa Helvetica
  }
}

/**
 * Converte um ArrayBuffer (arquivo binário) em uma string base64.
 * O jsPDF exige que fontes externas sejam fornecidas nesse formato.
 */
function bufToB64(buf) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin); // btoa() converte string binária → base64
}

/**
 * Registra a Roboto no documento jsPDF recebido e retorna o nome
 * da família de fontes que deve ser usada ('Roboto' ou 'helvetica').
 * O try/catch protege contra dados de fonte corrompidos ou inválidos.
 */
function setupDocFont(doc) {
  if (_robotoNormal && _robotoBold) {
    try {
      doc.addFileToVFS('Roboto-Regular.ttf', _robotoNormal);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.addFileToVFS('Roboto-Bold.ttf', _robotoBold);
      doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
      return 'Roboto';
    } catch (_) {
      // Fonte com dados inválidos → cai para Helvetica
    }
  }
  return 'helvetica'; // fallback sempre disponível no jsPDF
}


/* ------------------------------------------------------------
   FUNÇÕES AUXILIARES GERAIS
   ------------------------------------------------------------ */

/**
 * Converte o valor de um input type="month" (formato "YYYY-MM")
 * em uma string legível em português, ex: "Mar 2021".
 */
function formatMonth(value) {
  if (!value) return '';
  const [year, month] = value.split('-');
  return `${MONTHS_PT[parseInt(month, 10) - 1]} ${year}`;
}

/**
 * Navega para a etapa indicada pelo parâmetro `n`.
 * Atualiza: visibilidade dos painéis, estado visual dos steps,
 * largura da barra de progresso e posição do scroll da página.
 */
function goToStep(n) {
  if (n < 1 || n > TOTAL_STEPS) return;

  // Esconde todos os painéis e exibe apenas o da etapa `n`
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  document.getElementById(`step${n}`).classList.add('active');

  // Atualiza o estado visual de cada bolinha do progresso
  document.querySelectorAll('.step').forEach(el => {
    const sn = parseInt(el.dataset.step);
    el.classList.remove('active', 'done');
    if (sn === n) el.classList.add('active');       // etapa atual
    else if (sn < n) el.classList.add('done');      // etapas já concluídas
  });

  // Preenche a barra de progresso proporcional à etapa atual
  const fill = ((n - 1) / (TOTAL_STEPS - 1)) * 100;
  document.getElementById('progressFill').style.width = fill + '%';

  currentStep = n;

  // Rola a página até o início do wizard, respeitando o cabeçalho fixo
  const headerH = document.querySelector('.site-header').offsetHeight;
  const top     = document.getElementById('wizard').getBoundingClientRect().top
                  + window.scrollY - headerH - 12;
  window.scrollTo({ top, behavior: 'smooth' });
}


/* ------------------------------------------------------------
   BLOCOS DINÂMICOS — EXPERIÊNCIA PROFISSIONAL
   ------------------------------------------------------------ */

/**
 * Cria e insere um novo bloco de experiência profissional no formulário.
 * Cada bloco tem: cargo, empresa, período (início + fim ou "Presente"),
 * checkbox de emprego atual e descrição de funções.
 */
function addExperience() {
  expCount++;
  const id = `exp_${expCount}`; // ID único para este bloco

  const html = `
    <div class="entry-block" id="${id}">
      <div class="entry-header">
        <span>Experiência ${expCount}</span>
        <button type="button" class="btn-remove" onclick="removeEntry('${id}')">✕ Remover</button>
      </div>
      <div class="entry-grid">
        <div class="field">
          <label>Cargo <span class="req">*</span></label>
          <input type="text" data-exp="title" placeholder="Ex: Auxiliar Administrativo" />
        </div>
        <div class="field">
          <label>Empresa <span class="req">*</span></label>
          <input type="text" data-exp="company" placeholder="Ex: Grupo Horizonte Ltda." />
        </div>
        <div class="field">
          <label>Início</label>
          <input type="month" data-exp="start" />
        </div>
        <div class="field" id="${id}_end">
          <label>Fim</label>
          <input type="month" data-exp="end" />
        </div>
        <div class="field entry-full">
          <div class="checkbox-row">
            <input type="checkbox" id="${id}_current" data-exp="current"
                   onchange="toggleCurrentJob('${id}', this)" />
            <label for="${id}_current">Trabalho atual</label>
          </div>
        </div>
        <div class="field entry-full">
          <label>Funções</label>
          <textarea data-exp="functions" rows="4"
            placeholder="Ex: Organização de documentos, atendimento ao cliente, emissão de notas fiscais e suporte à equipe."></textarea>
        </div>
      </div>
    </div>`;

  document.getElementById('experienceList').insertAdjacentHTML('beforeend', html);
}

/**
 * Quando o usuário marca "Trabalho atual", desabilita e limpa o campo
 * "Fim" para que o período seja exibido como "Início – Presente" no PDF.
 */
function toggleCurrentJob(id, checkbox) {
  const endField = document.getElementById(`${id}_end`);
  const endInput = endField.querySelector('input');
  endInput.disabled      = checkbox.checked;
  endInput.value         = checkbox.checked ? '' : endInput.value;
  endField.style.opacity = checkbox.checked ? '0.4' : '1'; // feedback visual
}


/* ------------------------------------------------------------
   BLOCOS DINÂMICOS — FORMAÇÃO ACADÊMICA
   ------------------------------------------------------------ */

/**
 * Cria e insere um novo bloco de formação acadêmica no formulário.
 * Cada bloco tem: nome do curso, instituição, data de conclusão
 * e checkbox "Cursando atualmente".
 */
function addEducation() {
  eduCount++;
  const id = `edu_${eduCount}`; // ID único para este bloco

  const html = `
    <div class="entry-block" id="${id}">
      <div class="entry-header">
        <span>Formação ${eduCount}</span>
        <button type="button" class="btn-remove" onclick="removeEntry('${id}')">✕ Remover</button>
      </div>
      <div class="entry-grid">
        <div class="field">
          <label>Curso <span class="req">*</span></label>
          <input type="text" data-edu="degree" placeholder="Ex: Técnico em Administração" />
        </div>
        <div class="field">
          <label>Instituição <span class="req">*</span></label>
          <input type="text" data-edu="institution" placeholder="Ex: SENAI" />
        </div>
        <div class="field" id="${id}_conclusion">
          <label>Conclusão</label>
          <input type="month" data-edu="conclusion" />
        </div>
        <div class="field entry-full">
          <div class="checkbox-row">
            <input type="checkbox" id="${id}_studying" data-edu="studying"
                   onchange="toggleStudying('${id}', this)" />
            <label for="${id}_studying">Cursando atualmente</label>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('educationList').insertAdjacentHTML('beforeend', html);
}

/**
 * Quando o usuário marca "Cursando atualmente", desabilita e limpa o campo
 * "Conclusão" — o PDF exibirá "Em andamento" no lugar da data.
 */
function toggleStudying(id, checkbox) {
  const field = document.getElementById(`${id}_conclusion`);
  const input = field.querySelector('input');
  input.disabled      = checkbox.checked;
  input.value         = checkbox.checked ? '' : input.value;
  field.style.opacity = checkbox.checked ? '0.4' : '1';
}

/**
 * Remove um bloco de experiência ou formação pelo seu ID.
 */
function removeEntry(id) {
  document.getElementById(id).remove();
}


/* ------------------------------------------------------------
   COLETA DE DADOS DO FORMULÁRIO
   ------------------------------------------------------------ */

/**
 * Lê todos os campos do formulário e retorna um objeto com os dados
 * prontos para serem usados pela prévia e pelo gerador de PDF.
 */
function collectData() {
  return {
    name:        document.getElementById('name').value.trim(),
    email:       document.getElementById('email').value.trim(),
    phone:       document.getElementById('phone').value.trim(),
    nationality: document.getElementById('nationality').value.trim(),
    age:         document.getElementById('age').value.trim(),
    gender:      document.getElementById('gender').value.trim(),
    marital:     document.getElementById('marital').value.trim(),
    address:     document.getElementById('address').value.trim(),
    city:        document.getElementById('city').value.trim(),
    cep:         document.getElementById('cep').value.trim(),
    linkedin:    document.getElementById('linkedin').value.trim(),
    objective:   document.getElementById('objective').value.trim(),
    skills:      document.getElementById('skills').value.trim(),
    experiences: gatherExperiences(), // lista de objetos de experiência
    educations:  gatherEducation(),   // lista de objetos de formação
  };
}

/**
 * Percorre todos os blocos de experiência no DOM, extrai os valores
 * e monta o período formatado (ex: "Mar 2021 – Presente").
 * Filtra blocos vazios (sem cargo nem empresa).
 */
function gatherExperiences() {
  return Array.from(document.querySelectorAll('#experienceList .entry-block')).map(b => {
    const start   = b.querySelector('[data-exp="start"]').value;
    const end     = b.querySelector('[data-exp="end"]').value;
    const current = b.querySelector('[data-exp="current"]').checked;

    const startFmt = formatMonth(start);
    const endFmt   = current ? 'Presente' : formatMonth(end); // "Presente" se trabalho atual
    const period   = [startFmt, endFmt].filter(Boolean).join(' – ');

    return {
      title:     b.querySelector('[data-exp="title"]').value.trim(),
      company:   b.querySelector('[data-exp="company"]').value.trim(),
      period,
      functions: b.querySelector('[data-exp="functions"]').value.trim(),
    };
  }).filter(e => e.title || e.company); // descarta blocos completamente vazios
}

/**
 * Percorre todos os blocos de formação no DOM, extrai os valores
 * e define a conclusão como "Em andamento" se cursando atualmente.
 * Filtra blocos vazios (sem curso nem instituição).
 */
function gatherEducation() {
  return Array.from(document.querySelectorAll('#educationList .entry-block')).map(b => {
    const studying      = b.querySelector('[data-edu="studying"]').checked;
    const conclusionRaw = b.querySelector('[data-edu="conclusion"]').value;
    const conclusion    = studying ? 'Em andamento' : formatMonth(conclusionRaw);

    return {
      degree:      b.querySelector('[data-edu="degree"]').value.trim(),
      institution: b.querySelector('[data-edu="institution"]').value.trim(),
      conclusion,
    };
  }).filter(e => e.degree || e.institution);
}


/* ------------------------------------------------------------
   PRÉVIA DO CURRÍCULO (MODAL)
   Gera HTML formatado com os dados atuais e o exibe em um modal,
   permitindo ao usuário conferir antes de baixar o PDF.
   ------------------------------------------------------------ */

/**
 * Coleta os dados, monta o HTML da prévia e abre o modal.
 */
function showPreview() {
  const d = collectData();

  // Constrói as linhas de dados pessoais, ignorando campos vazios
  const personalLines = [
    d.nationality ? `Nacionalidade: ${d.nationality}` : null,
    d.age         ? `Idade: ${d.age}`                 : null,
    d.gender      ? `Gênero: ${d.gender}`             : null,
    d.marital     ? `Estado Civil: ${d.marital}`      : null,
    d.address     ? `Endereço: ${d.address}`          : null,
    d.city        ? `Cidade: ${d.city}`               : null,
    d.cep         ? `CEP: ${d.cep}`                   : null,
  ].filter(Boolean);

  // Gera uma linha de tabela com label e valor para a prévia
  function row(label, value, bold = false) {
    if (!value) return '';
    return `<tr>
      <td class="td-lbl">${label}</td>
      <td class="td-val ${bold ? 'td-bold' : ''}">${escHtml(value)}</td>
    </tr>`;
  }

  // Monta o HTML completo da prévia
  let html = `<div class="pv-name">${escHtml(d.name || '(Nome não preenchido)')}</div>
    ${personalLines.map(l => `<div class="pv-info">${escHtml(l)}</div>`).join('')}`;

  if (d.email || d.phone) {
    html += `<div class="pv-bar">
      ${d.email ? `<span><strong>E-mail:</strong> ${escHtml(d.email)}</span>` : ''}
      ${d.phone ? `<span><strong>Telefone:</strong> ${escHtml(d.phone)}</span>` : ''}
    </div>`;
  }

  if (d.objective) {
    html += `<div class="pv-section">Objetivo</div>
      <div class="pv-body">${escHtml(d.objective)}</div>`;
  }

  if (d.educations.length) {
    html += `<div class="pv-section">Formação acadêmica</div><table class="pv-table">`;
    d.educations.forEach((edu, i) => {
      html += row('Curso', edu.degree, true)
            + row('Instituição', edu.institution)
            + row('Conclusão', edu.conclusion);
      // Espaçador visual entre entradas
      if (i < d.educations.length - 1) html += `<tr class="pv-entry-gap"><td colspan="2"></td></tr>`;
    });
    html += `</table>`;
  }

  if (d.experiences.length) {
    html += `<div class="pv-section">Experiência</div><table class="pv-table">`;
    d.experiences.forEach((exp, i) => {
      html += row('Cargo', exp.title, true)
            + row('Empresa', exp.company)
            + row('Período', exp.period)
            + row('Funções', exp.functions);
      if (i < d.experiences.length - 1) html += `<tr class="pv-entry-gap"><td colspan="2"></td></tr>`;
    });
    html += `</table>`;
  }

  if (d.skills) {
    // Separa as habilidades por vírgula e junta com "•"
    const list = d.skills.split(',').map(s => s.trim()).filter(Boolean).join('   •   ');
    html += `<div class="pv-section">Habilidades</div>
      <div class="pv-body">${escHtml(list)}</div>`;
  }

  if (d.linkedin) {
    html += `<div class="pv-section">Links</div>
      <div class="pv-body" style="color:#0d9488">${escHtml(d.linkedin)}</div>`;
  }

  // Injeta o HTML no modal e o torna visível
  document.getElementById('previewContent').innerHTML = html;
  document.getElementById('previewOverlay').classList.add('open');
  document.body.style.overflow = 'hidden'; // impede scroll da página com modal aberto
}

/** Fecha o modal de prévia e restaura o scroll da página. */
function closePreview() {
  document.getElementById('previewOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

/** Fecha o modal ao clicar fora dele (no overlay escuro). */
function overlayClose(e) {
  if (e.target === document.getElementById('previewOverlay')) closePreview();
}

/**
 * Escapa caracteres especiais do HTML para evitar injeção de código
 * ao inserir dados do usuário diretamente no innerHTML.
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/* ------------------------------------------------------------
   GERAÇÃO DO PDF
   Usa a biblioteca jsPDF (carregada via CDN no HTML) para montar
   o currículo em formato A4 e disparar o download no navegador.
   ------------------------------------------------------------ */

/**
 * Ponto de entrada público para o botão "Baixar PDF".
 * Envolve a geração real em try/catch para capturar qualquer erro
 * inesperado e exibir uma mensagem amigável ao usuário.
 */
function generatePDF() {
  try {
    _generatePDF();
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    alert('Ocorreu um erro ao gerar o PDF. Verifique os campos e tente novamente.');
  }
}

/**
 * Lógica interna de geração do PDF.
 * Desenha o currículo seção por seção, usando coordenadas em milímetros
 * na página A4 (210 × 297 mm). A variável `y` representa a posição
 * vertical atual do "cursor" de escrita.
 */
function _generatePDF() {
  const d = collectData();

  // Validação mínima antes de gerar
  if (!d.name || !d.email) {
    alert('Preencha pelo menos Nome e E-mail antes de gerar o PDF.');
    goToStep(1);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc  = new jsPDF({ unit: 'mm', format: 'a4' });
  const FONT = setupDocFont(doc); // 'Roboto' se disponível, senão 'helvetica'

  /* Medidas da página (em mm) */
  const PW      = 210;             // largura total da página A4
  const ML      = 18;              // margem esquerda e direita
  const CW      = PW - ML * 2;    // largura útil do conteúdo (174 mm)
  const LABEL_W = 28;              // largura da coluna de rótulos (Cargo, Empresa etc.)
  const SEP_X   = ML + LABEL_W + 3; // posição X da linha separadora entre rótulo e valor
  const VAL_W   = CW - LABEL_W - 5; // largura disponível para o texto do valor

  let y = ML; // cursor vertical — começa na margem superior

  /* Paleta de cores usada no PDF (RGB) */
  const C_TEAL  = [13, 118, 110];  // verde-azulado para títulos e destaques
  const C_DARK  = [15, 23, 42];    // quase preto para o nome
  const C_GRAY  = [110, 120, 135]; // cinza médio para os rótulos
  const C_BLACK = [40, 40, 40];    // cor padrão do texto corrido

  /**
   * Verifica se há espaço suficiente para o próximo bloco.
   * Se não houver, adiciona uma nova página e reposiciona o cursor.
   * 282 mm = altura A4 (297) menos a margem inferior (~15 mm).
   */
  function newPageIfNeeded(needed = 12) {
    if (y + needed > 282) {
      doc.addPage();
      y = ML;
    }
  }

  /** Atalho para definir fonte e tamanho de uma vez. */
  function setF(style, size) {
    doc.setFont(FONT, style);
    doc.setFontSize(size);
  }

  /* ── Nome do candidato ──────────────────────────────────── */
  setF('bold', 28);
  doc.setTextColor(...C_DARK);
  doc.text(d.name, ML, y + 11);
  y += 18;

  /* ── Dados pessoais (texto corrido, um por linha) ────────── */
  const personalLines = [
    d.nationality ? `Nacionalidade: ${d.nationality}` : null,
    d.age         ? `Idade: ${d.age}`                 : null,
    d.gender      ? `Gênero: ${d.gender}`             : null,
    d.marital     ? `Estado Civil: ${d.marital}`      : null,
    d.address     ? `Endereço: ${d.address}`          : null,
    d.city        ? `Cidade: ${d.city}`               : null,
    d.cep         ? `CEP: ${d.cep}`                   : null,
  ].filter(Boolean); // remove campos não preenchidos

  setF('normal', 10);
  doc.setTextColor(...C_BLACK);
  personalLines.forEach(line => { doc.text(line, ML, y); y += 5.5; });
  y += 3;

  /* ── Barra de contato (fundo cinza claro com e-mail e telefone) */
  if (d.email || d.phone) {
    const barH = 13; // altura da barra em mm
    doc.setFillColor(235, 238, 242);
    doc.rect(ML, y, CW, barH, 'F'); // 'F' = preenchido (fill)

    const midX = ML + CW / 2; // ponto médio horizontal para dividir e-mail | telefone

    if (d.email) {
      setF('bold', 9.5);
      doc.setTextColor(...C_DARK);
      doc.text('E-mail:', ML + 5, y + 8);

      const lblW = doc.getTextWidth('E-mail:  ');
      setF('normal', 9.5);
      doc.setTextColor(...C_BLACK);

      // Trunca o e-mail caso seja longo demais para caber na metade da barra
      const maxW      = midX - ML - 5 - lblW - 4;
      const emailLines = doc.splitTextToSize(d.email, maxW);
      doc.text(emailLines[0], ML + 5 + lblW, y + 8);
    }

    if (d.phone) {
      setF('bold', 9.5);
      doc.setTextColor(...C_DARK);
      doc.text('Telefone:', midX + 5, y + 8);

      const lblW2 = doc.getTextWidth('Telefone:  ');
      setF('normal', 9.5);
      doc.setTextColor(...C_BLACK);
      doc.text(d.phone, midX + 5 + lblW2, y + 8);
    }

    y += barH + 8;
  } else {
    y += 4;
  }

  /* ── Título de seção (texto verde + linha horizontal) ────── */
  function drawSectionTitle(title) {
    newPageIfNeeded(18);
    setF('bold', 15);
    doc.setTextColor(...C_TEAL);
    doc.text(title, ML, y);
    y += 2.5;
    doc.setDrawColor(...C_TEAL);
    doc.setLineWidth(0.5);
    doc.line(ML, y, ML + CW, y); // linha decorativa abaixo do título
    y += 7;
    doc.setTextColor(...C_BLACK);
  }

  /**
   * Desenha uma linha do layout de tabela: rótulo à direita | linha | valor.
   * Suporta texto com múltiplas linhas (quando o valor é muito longo).
   * @param {string}  label - texto do rótulo (ex: "Cargo", "Empresa")
   * @param {string}  value - conteúdo a exibir
   * @param {boolean} bold  - se true, o valor é exibido em negrito
   */
  function drawRow(label, value, bold = false) {
    if (!value) return; // ignora campos não preenchidos

    setF(bold ? 'bold' : 'normal', bold ? 11 : 10);
    const lines = doc.splitTextToSize(value, VAL_W); // quebra automática de linha
    const rowH  = lines.length * 5.5 + 2;           // altura total da linha

    newPageIfNeeded(rowH + 2);

    // Rótulo alinhado à direita na coluna de labels
    setF('normal', 8.5);
    doc.setTextColor(...C_GRAY);
    doc.text(label, ML + LABEL_W, y, { align: 'right' });

    // Linha vertical separadora entre rótulo e valor
    doc.setDrawColor(210, 215, 220);
    doc.setLineWidth(0.3);
    doc.line(SEP_X - 1, y - 4.5, SEP_X - 1, y + rowH - 2);

    // Valor do campo
    setF(bold ? 'bold' : 'normal', bold ? 11 : 10);
    doc.setTextColor(...C_BLACK);
    doc.text(lines, SEP_X + 2, y);

    y += rowH; // avança o cursor para a próxima linha
  }

  /* ── Seção: Objetivo ────────────────────────────────────── */
  if (d.objective) {
    drawSectionTitle('Objetivo');
    setF('normal', 10.5);
    doc.setTextColor(...C_BLACK);
    const lines = doc.splitTextToSize(d.objective, CW - 10);
    newPageIfNeeded(lines.length * 5.5 + 4);
    doc.text(lines, ML + 8, y);
    y += lines.length * 5.5 + 8;
  }

  /* ── Seção: Formação acadêmica ──────────────────────────── */
  if (d.educations.length) {
    drawSectionTitle('Formação acadêmica');
    d.educations.forEach((edu, i) => {
      drawRow('Curso', edu.degree, true);       // curso em negrito
      drawRow('Instituição', edu.institution);
      drawRow('Conclusão', edu.conclusion);
      if (i < d.educations.length - 1) y += 6; // espaço entre entradas
    });
    y += 8;
  }

  /* ── Seção: Experiência profissional ────────────────────── */
  if (d.experiences.length) {
    drawSectionTitle('Experiência');
    d.experiences.forEach((exp, i) => {
      drawRow('Cargo', exp.title, true);        // cargo em negrito
      drawRow('Empresa', exp.company);
      drawRow('Período', exp.period);
      drawRow('Funções', exp.functions);
      if (i < d.experiences.length - 1) y += 6;
    });
    y += 8;
  }

  /* ── Seção: Habilidades ──────────────────────────────────── */
  if (d.skills) {
    drawSectionTitle('Habilidades');
    // Converte a lista CSV em texto separado por "•"
    const text  = d.skills.split(',').map(s => s.trim()).filter(Boolean).join('   •   ');
    setF('normal', 10.5);
    doc.setTextColor(...C_BLACK);
    const lines = doc.splitTextToSize(text, CW - 10);
    newPageIfNeeded(lines.length * 5.5 + 4);
    doc.text(lines, ML + 8, y);
    y += lines.length * 5.5;
  }

  /* ── Seção: Links (LinkedIn) ─────────────────────────────── */
  if (d.linkedin) {
    y += 8;
    drawSectionTitle('Links');
    setF('normal', 10.5);
    doc.setTextColor(...C_TEAL); // azul-verde para destacar como link
    doc.text(d.linkedin, ML + 8, y);
  }

  /* ── Salva e dispara o download do arquivo ──────────────── */
  // Nome do arquivo usa o nome do candidato em snake_case
  doc.save(`curriculo_${d.name.replace(/\s+/g, '_').toLowerCase()}.pdf`);
}


/* ------------------------------------------------------------
   INICIALIZAÇÃO
   Executado assim que o script é carregado pelo navegador.
   ------------------------------------------------------------ */

preloadRoboto(); // inicia o download da fonte Roboto em background
goToStep(1);     // garante que o wizard começa sempre na etapa 1
