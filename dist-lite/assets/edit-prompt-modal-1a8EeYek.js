import{B as e}from"./timer-audio-DiIFZnYs.js";import{i as t,n,r}from"./overlay-stack-Bl-MiH27.js";import{t as i}from"./backdrop-click-C5V4B5Tc.js";import{r as a}from"./icons-NHpSf5PW.js";import{ct as o}from"./main-V1sEHDTV.js";function s(){if(document.querySelector(`.pmd-prompt-overlay`))return;let s=t(),c=document.createElement(`div`);c.className=`pmd-prompt-overlay`,c.addEventListener(`click`,e=>{i(e,c)&&f()});let l=document.createElement(`div`);l.className=`pmd-prompt-dialog`,c.appendChild(l);let u=document.createElement(`header`);u.className=`pmd-prompt-header`;let d=document.createElement(`h2`);d.textContent=`AI cite-creator prompt`,u.appendChild(d);let f=()=>{c.remove(),document.removeEventListener(`keydown`,S),r(s)},p=document.createElement(`button`);p.type=`button`,p.className=`pmd-prompt-close`,a(p,`close`),p.title=`Close`,p.addEventListener(`click`,f),u.appendChild(p),l.appendChild(u);let m=document.createElement(`p`);m.className=`pmd-prompt-note`,m.textContent="This system prompt is sent to the AI before your selected citation text. Use `{DATE}` anywhere you want today's date substituted in (M-D-YYYY). The reply must use the delimited [[CITE]] … [[TOKENS]] … [[END]] block format at the bottom of the prompt — the editor splits on those exact markers to insert the cite and apply the F8 cite mark to each token, so leave that part intact unless you know what you're doing.",l.appendChild(m);let h=e.get(`aiCitePrompt`),g=document.createElement(`textarea`);g.className=`pmd-prompt-textarea`,g.spellcheck=!1,g.value=h||`Today's date is {DATE}.

You are an expert in formatting academic citations. Your task is to reformat the given citation to match the following style:

1. Author names should be in the format: FirstName LastName Date, where Date is:
   - The publication date in mm/dd format (or m/dd, or m/d, respectively, if the month or day require just one digit) for publications within the last month of the current year
   - The publication year in y format (for single-digit years) or yy format (for double-digit years) or yyyy (for years prior to 1950) for all other publications
2. For multiple authors, use '&' for two authors and 'et al.' for three or more.
3. After the author names, list their qualifications or affiliations.
4. Include the full title of the work in quotes.
5. Include publication details such as journal name, volume, issue, date (mm/dd/yyyy), and page numbers when available.
6. Include URLs or DOIs at the end of the citation when provided.
7. If the title or publication or names or qualifications are in all caps, change the capitalization so that it is appropriate for a cite.

Examples of the desired format:

(if today's date is less than a month after 9/23/24)
Adrien Rose & Christian Wilson 9/23, Rose is a research assistant in the Oxford Sustainable Finance Group, specializing in transition finance; Wilson is a DPhil student at the Smith School of Enterprise and the Environment (SSEE) and a Research Assistant in the Oxford Sustainable Finance Group, "Assessing the Credibility of Climate Transition Plans in the Oil and Gas Sector," Discussion Paper, Oxford Sustainable Finance Group, 09/23/2024, https://sustainablefinance.ox.ac.uk/wp-content/uploads/2024/09/SSEE-Discussion-Paper-Oil-Gas_final_AR.pdf

(if today's date is more than a month after 9/23/24)
Adrien Rose & Christian Wilson 24, Rose is a research assistant in the Oxford Sustainable Finance Group, specializing in transition finance; Wilson is a DPhil student at the Smith School of Enterprise and the Environment (SSEE) and a Research Assistant in the Oxford Sustainable Finance Group, "Assessing the Credibility of Climate Transition Plans in the Oil and Gas Sector," Discussion Paper, Oxford Sustainable Finance Group, 09/23/2024, https://sustainablefinance.ox.ac.uk/wp-content/uploads/2024/09/SSEE-Discussion-Paper-Oil-Gas_final_AR.pdf

(if today's date is less than a month after 9/9/24)
Keeff Felty & Grace Yarrow 9/9, Felty is President of the National Association of Wheat Growers; Yarrow is Food and Agriculture Policy Reporter at POLITICO, Author of POLITICO Pro's Morning Agriculture newsletter, University of Maryland graduate, "Ag groups hit the Hill," Politico, 9/9/24, https://www.politico.com/newsletters/weekly-agriculture/2024/09/09/ag-groups-hit-the-hill-00177896

(if today's date is more than a month after 9/9/24)
Keeff Felty & Grace Yarrow 24, Felty is President of the National Association of Wheat Growers; Yarrow is Food and Agriculture Policy Reporter at POLITICO, Author of POLITICO Pro's Morning Agriculture newsletter, University of Maryland graduate, "Ag groups hit the Hill," Politico, 9/9/24, https://www.politico.com/newsletters/weekly-agriculture/2024/09/09/ag-groups-hit-the-hill-00177896

J. D. Tuccille 23, Contributing Editor at Reason.com, former Managing Editor at Reason.com, columnist for Arizona Republic, Denver Post, and Washington Times, author of High Desert Barbecue, "It's Government Shutdown Theater, Again," Reason, 9/25/23, https://reason.com/2023/09/25/its-government-shutdown-theater-again/

Robert N. Stavins 18, A.J. Meyer Professor of Energy and Economic Development, John F. Kennedy School of Government, Harvard University; University Fellow, Resources for the Future; and Research Associate, National Bureau of Economic Research, "Environmental Economics," The New Palgrave Dictionary of Economics, edited by Garett Jones, Third edition, Palgrave Macmillan, 2018, pp. 3782–3795

Yael Parag & Sarah Darby 9, Parag is the Vice Dean of Reichman University's School of Sustainability at Reichman University (IDC); Derby is BSc DPhil, Associate Professor, Energy Programme, Environmental Change Institute, University of Oxford, "Consumer–Supplier–Government Triangular Relations: Rethinking the UK Policy Path for Carbon Emissions Reduction from the UK Residential Sector," Energy Policy, vol. 37, no. 10, 10/01/2009, pp. 3984–3992

Jie Jiang et al. 23, Jie Jiang, School of Intellectual Property at Nanjing University of Science and Technology; Qihang Zhang, School of Intellectual Property at Nanjing University of Science and Technology; Yifan Hui, School of Mathematics and Statistics at University of Glasgow, "The Impact of Market and Non-Market-Based Environmental Policy Instruments on Firms' Sustainable Technological Innovation: Evidence from Chinese Firms," Sustainability, vol. 15, no. 5, 5, Multidisciplinary Digital Publishing Institute, 01/15/2023, p. 4425

Important:
- Do not remove any information from the citation that was included in the submission.
- Do not add any information to the citation that was not included in the submission.
- If the title or publication or names or qualifications are in another language, translate them to English.

Respond using the delimited block format below — no JSON, no quoting, no escaping. Quotes inside the cite (around the title, for instance) just appear literally; the parser splits on the markers, not the punctuation.

[[CITE]]
<the full reformatted citation, exactly as you'd otherwise have returned it>
[[TOKENS]]
<one token per line>
[[END]]

The TOKENS section lists every substring that should be highlighted with the F8 cite mark. The highlighted portion is the LASTNAME(s) + SHORTDATE of the leading author block; firstnames stay unmarked.

  - One author ("Michael Townsend 25"): TOKENS = "Townsend 25"
  - Two authors ("Laura Weiss & John Bresnahan 3/26"): TOKENS = "Weiss & " then "Bresnahan 3/26" on the next line
  - Three+ authors ("Carla Norrlöf et al. 24"): TOKENS = "Norrlöf et al. 24"

For the two-author case, the first token ends with "& " (ampersand + trailing space) and the second token starts with the second lastname — the firstname between them stays unmarked. For "et al." cases the whole "Lastname et al. Date" is one contiguous token. Each token MUST be a verbatim substring of the cite so the editor can locate it.`,g.rows=24,l.appendChild(g);let _=document.createElement(`footer`);_.className=`pmd-prompt-footer`;let v=document.createElement(`button`);v.type=`button`,v.className=`pmd-prompt-btn`,v.textContent=`Restore default`,v.addEventListener(`click`,()=>{g.value=o}),_.appendChild(v);let y=document.createElement(`span`);y.style.flex=`1`,_.appendChild(y);let b=document.createElement(`button`);b.type=`button`,b.className=`pmd-prompt-btn`,b.textContent=`Cancel`,b.addEventListener(`click`,f),_.appendChild(b);let x=document.createElement(`button`);x.type=`button`,x.className=`pmd-prompt-btn pmd-prompt-btn-primary`,x.textContent=`Save`,x.addEventListener(`click`,()=>{let t=g.value;e.set(`aiCitePrompt`,t.trim()===`Today's date is {DATE}.

You are an expert in formatting academic citations. Your task is to reformat the given citation to match the following style:

1. Author names should be in the format: FirstName LastName Date, where Date is:
   - The publication date in mm/dd format (or m/dd, or m/d, respectively, if the month or day require just one digit) for publications within the last month of the current year
   - The publication year in y format (for single-digit years) or yy format (for double-digit years) or yyyy (for years prior to 1950) for all other publications
2. For multiple authors, use '&' for two authors and 'et al.' for three or more.
3. After the author names, list their qualifications or affiliations.
4. Include the full title of the work in quotes.
5. Include publication details such as journal name, volume, issue, date (mm/dd/yyyy), and page numbers when available.
6. Include URLs or DOIs at the end of the citation when provided.
7. If the title or publication or names or qualifications are in all caps, change the capitalization so that it is appropriate for a cite.

Examples of the desired format:

(if today's date is less than a month after 9/23/24)
Adrien Rose & Christian Wilson 9/23, Rose is a research assistant in the Oxford Sustainable Finance Group, specializing in transition finance; Wilson is a DPhil student at the Smith School of Enterprise and the Environment (SSEE) and a Research Assistant in the Oxford Sustainable Finance Group, "Assessing the Credibility of Climate Transition Plans in the Oil and Gas Sector," Discussion Paper, Oxford Sustainable Finance Group, 09/23/2024, https://sustainablefinance.ox.ac.uk/wp-content/uploads/2024/09/SSEE-Discussion-Paper-Oil-Gas_final_AR.pdf

(if today's date is more than a month after 9/23/24)
Adrien Rose & Christian Wilson 24, Rose is a research assistant in the Oxford Sustainable Finance Group, specializing in transition finance; Wilson is a DPhil student at the Smith School of Enterprise and the Environment (SSEE) and a Research Assistant in the Oxford Sustainable Finance Group, "Assessing the Credibility of Climate Transition Plans in the Oil and Gas Sector," Discussion Paper, Oxford Sustainable Finance Group, 09/23/2024, https://sustainablefinance.ox.ac.uk/wp-content/uploads/2024/09/SSEE-Discussion-Paper-Oil-Gas_final_AR.pdf

(if today's date is less than a month after 9/9/24)
Keeff Felty & Grace Yarrow 9/9, Felty is President of the National Association of Wheat Growers; Yarrow is Food and Agriculture Policy Reporter at POLITICO, Author of POLITICO Pro's Morning Agriculture newsletter, University of Maryland graduate, "Ag groups hit the Hill," Politico, 9/9/24, https://www.politico.com/newsletters/weekly-agriculture/2024/09/09/ag-groups-hit-the-hill-00177896

(if today's date is more than a month after 9/9/24)
Keeff Felty & Grace Yarrow 24, Felty is President of the National Association of Wheat Growers; Yarrow is Food and Agriculture Policy Reporter at POLITICO, Author of POLITICO Pro's Morning Agriculture newsletter, University of Maryland graduate, "Ag groups hit the Hill," Politico, 9/9/24, https://www.politico.com/newsletters/weekly-agriculture/2024/09/09/ag-groups-hit-the-hill-00177896

J. D. Tuccille 23, Contributing Editor at Reason.com, former Managing Editor at Reason.com, columnist for Arizona Republic, Denver Post, and Washington Times, author of High Desert Barbecue, "It's Government Shutdown Theater, Again," Reason, 9/25/23, https://reason.com/2023/09/25/its-government-shutdown-theater-again/

Robert N. Stavins 18, A.J. Meyer Professor of Energy and Economic Development, John F. Kennedy School of Government, Harvard University; University Fellow, Resources for the Future; and Research Associate, National Bureau of Economic Research, "Environmental Economics," The New Palgrave Dictionary of Economics, edited by Garett Jones, Third edition, Palgrave Macmillan, 2018, pp. 3782–3795

Yael Parag & Sarah Darby 9, Parag is the Vice Dean of Reichman University's School of Sustainability at Reichman University (IDC); Derby is BSc DPhil, Associate Professor, Energy Programme, Environmental Change Institute, University of Oxford, "Consumer–Supplier–Government Triangular Relations: Rethinking the UK Policy Path for Carbon Emissions Reduction from the UK Residential Sector," Energy Policy, vol. 37, no. 10, 10/01/2009, pp. 3984–3992

Jie Jiang et al. 23, Jie Jiang, School of Intellectual Property at Nanjing University of Science and Technology; Qihang Zhang, School of Intellectual Property at Nanjing University of Science and Technology; Yifan Hui, School of Mathematics and Statistics at University of Glasgow, "The Impact of Market and Non-Market-Based Environmental Policy Instruments on Firms' Sustainable Technological Innovation: Evidence from Chinese Firms," Sustainability, vol. 15, no. 5, 5, Multidisciplinary Digital Publishing Institute, 01/15/2023, p. 4425

Important:
- Do not remove any information from the citation that was included in the submission.
- Do not add any information to the citation that was not included in the submission.
- If the title or publication or names or qualifications are in another language, translate them to English.

Respond using the delimited block format below — no JSON, no quoting, no escaping. Quotes inside the cite (around the title, for instance) just appear literally; the parser splits on the markers, not the punctuation.

[[CITE]]
<the full reformatted citation, exactly as you'd otherwise have returned it>
[[TOKENS]]
<one token per line>
[[END]]

The TOKENS section lists every substring that should be highlighted with the F8 cite mark. The highlighted portion is the LASTNAME(s) + SHORTDATE of the leading author block; firstnames stay unmarked.

  - One author ("Michael Townsend 25"): TOKENS = "Townsend 25"
  - Two authors ("Laura Weiss & John Bresnahan 3/26"): TOKENS = "Weiss & " then "Bresnahan 3/26" on the next line
  - Three+ authors ("Carla Norrlöf et al. 24"): TOKENS = "Norrlöf et al. 24"

For the two-author case, the first token ends with "& " (ampersand + trailing space) and the second token starts with the second lastname — the firstname between them stays unmarked. For "et al." cases the whole "Lastname et al. Date" is one contiguous token. Each token MUST be a verbatim substring of the cite so the editor can locate it.`?``:t),f()}),_.appendChild(x),l.appendChild(_),document.body.appendChild(c);let S=e=>{e.key===`Escape`&&n(s)&&f()};document.addEventListener(`keydown`,S),requestAnimationFrame(()=>g.focus())}export{s as openCitePromptEditor};