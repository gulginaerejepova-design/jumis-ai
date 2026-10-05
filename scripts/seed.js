// Fills the database with starter content so the site is not empty on day one.
//   npm run seed                  → starter content + demo accounts (password: demo12345)
//   npm run seed -- --no-demo     → starter content only (no demo users)
// Safe to run once; it stops if courses already exist.
import { loadEnv } from '../src/env.js';
loadEnv();
const { q, uniqueSlug } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const withDemo = !process.argv.includes('--no-demo');
if (q.get('SELECT COUNT(*) n FROM courses').n > 0) {
  console.log('Database already has courses — seed skipped.');
  process.exit(0);
}

const user = (email, full_name, extra = {}) => {
  const existing = q.get('SELECT id FROM users WHERE email = ?', email);
  if (existing) return existing.id;
  return q.insert('users', { email, full_name, password_hash: hashPassword('demo12345'), ...extra });
};

let teacherId = null;
let studentId = null;
let orgId = null;
if (withDemo) {
  teacherId = user('teacher@demo.jumis', 'Aziza Seytmuratova', { role: 'teacher', user_type: 'teacher', bio: 'Programmalastırıw oqıtıwshısı.' });
  q.run(`INSERT OR IGNORE INTO teacher_profiles (user_id, headline, bio, experience_years, education, specialization, contact_email, telegram, is_visible)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, teacherId, 'Python hám veb-programmalastırıw oqıtıwshısı', 'Jaslarǵa programmalastırıwdı ápiwayı hám ámeliy túrde úyretemen. 6 jıllıq tájiriybe.', 6, 'Qaraqalpaq mámleketlik universiteti, Informatika', 'Programmalastırıw', 'teacher@demo.jumis', '@demo_teacher');
  studentId = user('student@demo.jumis', 'Dilnoza Allanazarova', {
    user_type: 'student', phone: '+998 90 000 00 00', bio: 'Informatika fakultetiniń 3-kurs studenti. Python hám veb-dizayn menen qızıǵaman.',
    future_goals: 'Jasalma intellekt hám veb-programmalastırıw boyınsha qánige bolıwdı, keleshekte óz IT startapımdı ashıwdı qáleymen.', open_to_work: 1,
  });
  user('student2@demo.jumis', 'Timur Qalliev', { user_type: 'student', future_goals: 'Python, maǵlıwmatlar analitikası hám jasalma intellekt. IT kompaniyada islew hám startap qurıw.' });
  user('student3@demo.jumis', 'Gulnara Ismayilova', { user_type: 'student', future_goals: 'Dizayn, UI/UX hám veb-saytlar jaratıw. Frilanser bolıp xalıqaralıq klientler menen islew.' });
  orgId = user('org@demo.jumis', 'Aral Tech HR', { user_type: 'organization', organization_name: 'Aral Tech (demo)' });
}

// ─── Courses ──────────────────────────────────────────────────────────────────
const courses = [
  {
    title: 'Python programmalastırıw tiykarları', category: 'Programmalastırıw', level: 'beginner', thumbnail_url: '/public/img/courses/python.png',
    description: 'Programmalastırıwdı nólden baslań: ózgeriwshiler, shártler, cikller, funkciyalar hám dizimler.\n\n- Ámeliy mısallar\n- Hár sabaqtan keyin test\n- Juwmaqlawshı test hám sertifikat',
    lessons: [
      ['Programmalastırıw degen ne?', 'Kompyuter qalay oylaydı, algoritm hám programma túsinikleri.', 'zOjov-2OZ0E', '12:30'],
      ['Python: birinshi programma', 'Python ornatıw, print(), ózgeriwshiler hám maǵlıwmat túrleri.', 'rfscVS0vtbw', '18:45'],
      ['Shártler hám cikller', 'if / else, for hám while cikllerin ámelde qollanıw.', 'rfscVS0vtbw', '21:10'],
    ],
    tests: [
      { type: 'lesson', lesson: 0, title: '1-sabaq testi', questions: [
        ['Algoritm degen ne?', 'Mashqalanı sheshiw ushın qádemler izbe-izligi', 'Kompyuter bólegi', 'Programma tili', 'Internet brauzeri', 'a', 'Tiykarlar'],
        ['Qaysısı programmalastırıw tili?', 'Excel', 'Python', 'Windows', 'Chrome', 'b', 'Tiykarlar'],
        ['Kompyuter qaysı sanaq sistemasında isleydi?', 'Onlıq', 'Segizlik', 'Ekilik', 'On altılıq', 'c', 'Tiykarlar'],
      ] },
      { type: 'final', title: 'Python — juwmaqlawshı test', questions: [
        ['print("Sálem") nátiyjesi qanday?', 'Sálem', '"Sálem"', 'print', 'Qátelik', 'a', 'Sintaksis'],
        ['x = 5; x = x + 2. x neshege teń?', '5', '2', '7', '52', 'c', 'Ózgeriwshiler'],
        ['Python-da dizim qalay jazıladı?', '(1, 2, 3)', '[1, 2, 3]', '{1, 2, 3}', '<1, 2, 3>', 'b', 'Maǵlıwmat túrleri'],
        ['for i in range(3): neshe ret isleydi?', '2', '3', '4', 'Sheksiz', 'b', 'Cikller'],
        ['Shártti tekseriw ushın qaysı sóz qollanıladı?', 'loop', 'if', 'def', 'import', 'b', 'Shártler'],
      ] },
    ],
    assignment: { lesson: 1, title: 'Óz atıńızdı shıǵaratuǵın programma', description: 'Paydalanıwshıdan atın sorap, "Sálem, <at>!" dep shıǵaratuǵın Python programmasın jazıń. Kodıńızdı usı jerge qoyıń.' },
  },
  {
    title: 'Veb-sayt jaratıw: HTML, CSS hám JavaScript', category: 'Veb-programmalastırıw', level: 'beginner', thumbnail_url: '/public/img/courses/web.png',
    description: 'Óz veb-saytıńızdı jaratıń: HTML strukturası, CSS dizaynı hám JavaScript penen interaktivlik.',
    lessons: [
      ['HTML: bet strukturası', 'Teglar, sarlawhalar, siltemeler, súwretler hám formalar.', 'pQN-pnXPaVg', '25:00'],
      ['CSS: dizayn hám reńler', 'Selektorlar, reńler, shriftler, flexbox.', '1Rs2ND1ryYc', '30:00'],
      ['JavaScript: interaktivlik', 'Ózgeriwshiler, funkciyalar hám bet elementleri menen islew.', 'PkZNo7MFNFg', '28:00'],
    ],
    tests: [
      { type: 'level', title: 'Veb tiykarları — dárejelik test', questions: [
        ['HTML neni anıqlaydı?', 'Bet strukturasın', 'Serverdi', 'Maǵlıwmatlar bazasın', 'Paroldi', 'a', 'HTML'],
        ['Qaysı teg siltemeni jaratadı?', '<p>', '<a>', '<div>', '<img>', 'b', 'HTML'],
        ['CSS ne ushın kerek?', 'Bettiń kórinisi ushın', 'Maǵlıwmat saqlaw ushın', 'Server ushın', 'Email jiberiw ushın', 'a', 'CSS'],
        ['JavaScript qay jerde isleydi?', 'Tek serverde', 'Brauzerde (hám serverde)', 'Tek Excel-de', 'Printerde', 'b', 'JavaScript'],
      ] },
    ],
  },
  {
    title: 'SQL hám maǵlıwmatlar bazası', category: 'Maǵlıwmatlar', level: 'intermediate', thumbnail_url: '/public/img/courses/sql.png',
    description: 'Maǵlıwmatlar bazası qalay isleydi, SELECT, WHERE, JOIN sorawların jazıwdı úyreniń.',
    lessons: [['SQL kirispe hám SELECT', 'Kesteler, qatarlar, SELECT hám WHERE.', 'HXV3zeQKqGY', '35:00']],
    tests: [],
  },
];

for (const c of courses) {
  const courseId = q.insert('courses', { slug: uniqueSlug('courses', c.title), title: c.title, description: c.description, category: c.category, level: c.level, thumbnail_url: c.thumbnail_url, is_published: 1, owner_id: teacherId });
  const lessonIds = c.lessons.map(([title, description, yt, duration], i) => q.insert('lessons', { course_id: courseId, title, description, video_type: 'external', external_url: `https://www.youtube.com/watch?v=${yt}`, duration, sort_order: i + 1 }));
  for (const tst of c.tests) {
    const testId = q.insert('tests', { course_id: courseId, lesson_id: tst.lesson != null ? lessonIds[tst.lesson] : null, title: tst.title, test_type: tst.type, time_limit_minutes: 10, pass_percent: 60 });
    tst.questions.forEach(([question, a, b, cc, d, correct, topic], i) => q.insert('test_questions', { test_id: testId, question, option_a: a, option_b: b, option_c: cc, option_d: d, correct, topic, sort_order: i + 1 }));
  }
  if (c.assignment) q.insert('assignments', { course_id: courseId, lesson_id: lessonIds[c.assignment.lesson], title: c.assignment.title, description: c.assignment.description, created_by: teacherId });
  if (studentId && c === courses[0]) {
    q.insert('enrollments', { user_id: studentId, course_id: courseId, id_number: 'AA0000000', phone: '+998 90 000 00 00', verified: 1 });
    q.insert('lesson_progress', { user_id: studentId, lesson_id: lessonIds[0] });
  }
}

// ─── Skill question bank ──────────────────────────────────────────────────────
const skill = [
  ['Logika', 'Barlıq A — B. Barlıq B — C. Demek...', 'Barlıq A — C', 'Barlıq C — A', 'Hesh A — C emes', 'Anıqlap bolmaydı', 'a', 'easy'],
  ['Logika', '2, 4, 8, 16, ... keyingi san?', '18', '24', '32', '30', 'c', 'easy'],
  ['Logika', 'Eger búgin seysenbi bolsa, 3 kúnnen keyin qaysı kún?', 'Juma', 'Piyshembi', 'Shembi', 'Jeksenbi', 'a', 'medium'],
  ['Logika', '5 mashina 5 detaldı 5 minutta islep shıǵaradı. 100 mashina 100 detaldı neshe minutta?', '100', '20', '5', '1', 'c', 'hard'],
  ['Matematika', '15% of 200 = ?', '15', '30', '20', '45', 'b', 'easy'],
  ['Matematika', '3x + 5 = 20. x = ?', '5', '15', '3', '25', 'a', 'easy'],
  ['Matematika', 'Tovardıń bahası 20% arzanlap 80 000 boldı. Aldıńǵı bahası?', '96 000', '100 000', '64 000', '120 000', 'b', 'medium'],
  ['Matematika', 'Ortasha mánis: 4, 8, 6, 10?', '6', '7', '8', '28', 'b', 'easy'],
  ['Programmalastırıw', 'Qaysısı maǵlıwmatlar bazası tili?', 'HTML', 'SQL', 'CSS', 'PNG', 'b', 'easy'],
  ['Programmalastırıw', 'Cikl degen ne?', 'Bir neshe ret tákirarlanatuǵın kod', 'Ózgeriwshi túri', 'Qátelik', 'Fayl', 'a', 'easy'],
  ['Programmalastırıw', 'Git ne ushın qollanıladı?', 'Súwret redaktorlaw', 'Kod versiyaların basqarıw', 'Email jiberiw', 'Video montaj', 'b', 'medium'],
  ['Programmalastırıw', 'Funkciya degen ne?', 'Atı bar, qayta qollanılatuǵın kod bloki', 'Kompyuter bólegi', 'Internet protokolı', 'Shrift', 'a', 'medium'],
  ['Kommunikaciya', 'Jumıs beriwshige birinshi xatta eń zárúrli nárse?', 'Uzın tariyxıńız', 'Qısqa, anıq hám nege mas ekenińiz', 'Tek aylıq haqqında', 'Emoji', 'b', 'easy'],
  ['Kommunikaciya', 'Komandada kelispewshilik bolsa, eń jaqsı qádem?', 'Úndemey ketiw', 'Tıńlap, faktlerge tiykarlanıp sóylesiw', 'Baslıqqa shaǵım etiw', 'Baqırıw', 'b', 'easy'],
  ['Kommunikaciya', 'Intervyuda "Ázzi tárepińiz?" sorawına eń jaqsı juwap?', '"Menin ázzi tárepim joq"', 'Haqıyqıy ázzi tárep + onı qalay rawajlandırıp atırǵanıńız', 'Juwap bermew', 'Basqalardı ayıplaw', 'b', 'medium'],
  ['Ingliz tili', 'Choose the correct sentence:', 'She go to work.', 'She goes to work.', 'She going to work.', 'She gone to work.', 'b', 'easy'],
  ['Ingliz tili', '"Resume" means...', 'Holiday', 'A document about your skills and experience', 'A salary', 'An office', 'b', 'easy'],
  ['Ingliz tili', 'I have lived here ___ 2020.', 'for', 'since', 'from', 'at', 'b', 'medium'],
  ['Cifrlı sawatlılıq', 'Kúshli parol qaysı?', '123456', 'qwerty', 'M@ktab2026!Nukus', 'password', 'c', 'easy'],
  ['Cifrlı sawatlılıq', 'Fishing (phishing) degen ne?', 'Balıq awlaw oyını', 'Aldaw arqalı paroldi urlaw', 'Antivirus', 'Bult xızmeti', 'b', 'medium'],
  ['Cifrlı sawatlılıq', 'PDF formatı ne ushın qolaylı?', 'Hújjet hár qanday qurılmada birdey kórinedi', 'Tek video ushın', 'Ózgertiw ushın eń ańsat', 'Kólemi hámme waqıt kishi', 'a', 'easy'],
];
skill.forEach(([category, question, a, b, c, d, correct, difficulty]) => q.insert('skill_questions', { category, question, option_a: a, option_b: b, option_c: c, option_d: d, correct, difficulty }));

// ─── Vacancies ────────────────────────────────────────────────────────────────
const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const in45 = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
const vacancies = [
  ['Junior Python dasturshı', 'Aral Tech (demo)', 'full_time', 'junior', 'Nókis', '6 000 000 – 9 000 000 so\'m', '**Mindetler:**\n- Ishki xızmetler ushın Python skriptler jazıw\n- Maǵlıwmatlar bazası menen islew\n\n**Talaplar:**\n- Python tiykarları\n- SQL tiykarları — artıqmashılıq\n- Úyreniwge talpınıw', in30],
  ['Veb-dizayn stajirovkası', 'Aral Tech (demo)', 'internship', 'no_experience', 'Nókis', '2 500 000 so\'m', 'HTML/CSS bilgen studentler ushın 3 aylıq stajirovka. Ámeliy jobalar hám mentor.', in45],
  ['SMM menejer', 'Qaraqalpaq Digital (demo)', 'part_time', 'junior', 'Nókis', 'Kelisim boyınsha', 'Instagram hám Telegram kanalların júrgiziw, kontent jobalastırıw.', in30],
  ['Frontend dasturshı (qashıqtan)', 'Qaraqalpaq Digital (demo)', 'remote', 'mid', 'Qashıqtan', '1 000 – 1 500 USD', 'React yamasa Vue menen 1+ jıl tájiriybe. Komandada islew kónlikpesi.', in45],
  ['Maǵlıwmat operatorı', 'Nókis Biznes Orayı (demo)', 'full_time', 'no_experience', 'Nókis', '4 000 000 so\'m', 'Excel hám kompyuter sawatlılıǵı. Itibarlı hám juwapkerli bolıw.', in30],
];
const vacIds = vacancies.map(([title, organization, job_type, experience_level, address, salary, description, deadline]) =>
  q.insert('vacancies', { slug: uniqueSlug('vacancies', `${title}-${organization}`), owner_id: organization === 'Aral Tech (demo)' ? orgId : null, title, organization, job_type, experience_level, address, salary, description, deadline, contact_email: 'hr@example.com' }));
if (studentId) q.insert('applications', { vacancy_id: vacIds[0], user_id: studentId, cover_letter: 'Python boyınsha kursımdı tamamlap atırman hám ámeliy jobalarda islewge tayarman.' });

// ─── Community content ────────────────────────────────────────────────────────
const community = [
  ['video_explanation', 'Programmalastırıwǵa kirispe', 'Programmalastırıwdı baslawdan aldın kóriwge turarlı video.', 'https://www.youtube.com/watch?v=zOjov-2OZ0E'],
  ['useful_link', 'freeCodeCamp (YouTube)', 'Biypul tolıq kurslar — programmalastırıw, veb, maǵlıwmatlar.', 'https://www.youtube.com/@freecodecamp', { platform: 'youtube' }],
  ['useful_link', 'Python rásmiy hújjetleri', 'Python tiliniń rásmiy qollanbası.', 'https://docs.python.org/3/', { platform: 'other' }],
  ['news', 'Jumıs AI platforması iske tústi', 'Jańa platformada kurslar, AI karyera keńesshisi hám vakansiyalar bir jerde.', null, { date: new Date().toISOString().slice(0, 10) }],
  ['event', 'Karyera kúni (demo)', 'Jumıs beriwshiler menen ushırasıw hám CV boyınsha keńesler.', null, { date: in30 }],
  ['support_info', 'Qollap-quwatlaw', 'Dúysenbi–Juma, 9:00–18:00. (Bul maǵlıwmattı Admin → Jámiyet bóliminde ózgertiń.)', null, { contact: '+998 00 000 00 00' }],
];
community.forEach(([type, title, description, url, extra = {}], i) => q.insert('community_content', { type, title, description, url, sort_order: i, ...extra }));

console.log('\n✔ Starter content created: 3 courses, tests, 21 skill questions, 5 vacancies, community content.');
if (withDemo) {
  console.log('\nDemo accounts (password: demo12345):');
  console.log('  teacher@demo.jumis   — teacher');
  console.log('  student@demo.jumis   — student');
  console.log('  org@demo.jumis       — organization');
  console.log('\nThe FIRST account you register yourself becomes the admin.');
  console.log('Before going public, delete the demo accounts in Admin → Users.\n');
}
