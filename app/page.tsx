"use client";

import { createClient, type User } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

type Activity = "exercise" | "reading";
type Member = { id: string; display_name: string; user_id: string | null; role: "admin" | "member" };
type Attendance = { id: string; member_id: string; activity: Activity; attended_on: string };

const PROJECT_START = "2026-08-08";
const PROJECT_END = "2026-09-04";
const fallbackMembers: Member[] = [
  { id: "1", display_name: "서윤", user_id: null, role: "member" },
  { id: "2", display_name: "민지", user_id: null, role: "member" },
  { id: "3", display_name: "지우", user_id: null, role: "member" },
  { id: "4", display_name: "현지", user_id: null, role: "member" },
  { id: "5", display_name: "하은", user_id: null, role: "member" },
];
const fallbackAttendance: Attendance[] = [
  ["1","exercise","2026-08-15"],["1","exercise","2026-08-16"],["1","reading","2026-08-15"],
  ["2","exercise","2026-08-15"],["2","reading","2026-08-15"],["2","reading","2026-08-16"],
  ["3","exercise","2026-08-15"],["3","exercise","2026-08-16"],["3","reading","2026-08-16"],
  ["4","reading","2026-08-15"],["5","exercise","2026-08-16"],
].map(([member_id,activity,attended_on], index) => ({ id: String(index), member_id, activity: activity as Activity, attended_on }));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

function isoInSeoul(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function getWeek(dateValue: string) {
  const start = new Date(`${PROJECT_START}T00:00:00+09:00`);
  const current = new Date(`${dateValue}T00:00:00+09:00`);
  const raw = Math.floor((current.getTime() - start.getTime()) / 86400000 / 7) + 1;
  return Math.min(4, Math.max(1, raw));
}

function weekRange(week: number) {
  const projectStart = new Date(`${PROJECT_START}T00:00:00+09:00`).getTime();
  const start = new Date(projectStart + (week - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  const startIso = isoInSeoul(start);
  const endIso = isoInSeoul(end);
  const fmt = (value: string) => `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`;
  return { start: startIso, end: endIso, label: `${fmt(startIso)} — ${fmt(endIso)}` };
}

function Marks({ count, activity }: { count: number; activity: Activity }) {
  return <span className={`marks ${activity}`} aria-label={`3회 중 ${count}회 완료`}>
    {[0,1,2].map(i => <i className={i < count ? "done" : ""} key={i}>{i < count ? "✓" : ""}</i>)}
  </span>;
}

export default function Home() {
  const today = isoInSeoul(new Date());
  const latestAllowedDate = today < PROJECT_START ? PROJECT_START : today > PROJECT_END ? PROJECT_END : today;
  const [week, setWeek] = useState(getWeek(today));
  const [members, setMembers] = useState<Member[]>(supabase ? [] : fallbackMembers);
  const [attendance, setAttendance] = useState<Attendance[]>(supabase ? [] : fallbackAttendance);
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Member | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [memberLines, setMemberLines] = useState("");
  const [activity, setActivity] = useState<Activity>("exercise");
  const [date, setDate] = useState(latestAllowedDate);
  const [memberId, setMemberId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const range = weekRange(week);

  const load = async (activeUser?: User | null) => {
    if (!supabase) return;
    const [{ data: memberData }, { data: attendanceData }] = await Promise.all([
      supabase.from("members").select("id,display_name,user_id,role").eq("active", true).order("display_name"),
      supabase.from("attendance").select("id,member_id,activity,attended_on").gte("attended_on", PROJECT_START).lte("attended_on", PROJECT_END),
    ]);
    if (memberData) setMembers(memberData as Member[]);
    if (attendanceData) setAttendance(attendanceData as Attendance[]);
    const currentUser = activeUser === undefined ? (await supabase.auth.getUser()).data.user : activeUser;
    setUser(currentUser ?? null);
    const profile = memberData?.find(item => item.user_id === currentUser?.id) as Member | undefined;
    setMe(profile ?? null);
    if (profile) setMemberId(profile.id);
    setSetupOpen(Boolean(currentUser && !profile && memberData?.length === 0));
  };

  useEffect(() => {
    if (!supabase) return;
    load();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => load(session?.user ?? null));
    const channel = supabase.channel("bmt-attendance").on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, () => load()).subscribe();
    return () => { data.subscription.unsubscribe(); supabase.removeChannel(channel); };
  }, []);

  const rows = useMemo(() => members.map(member => {
    const records = attendance.filter(a => a.member_id === member.id && a.attended_on >= range.start && a.attended_on <= range.end);
    return { ...member, exercise: records.filter(a => a.activity === "exercise").length, reading: records.filter(a => a.activity === "reading").length, latest: records.map(a => a.attended_on).sort().at(-1) };
  }), [members, attendance, range.start, range.end]);
  const completed = rows.filter(row => row.exercise >= 3 && row.reading >= 3).length;
  const totalDone = rows.reduce((sum, row) => sum + Math.min(3,row.exercise) + Math.min(3,row.reading), 0);
  const percent = rows.length ? Math.round(totalDone / (rows.length * 6) * 100) : 0;

  const sendLink = async () => {
    if (!supabase || !email.trim()) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin, shouldCreateUser: true } });
    setBusy(false); setMessage(error ? error.message : "이메일로 보낸 로그인 링크를 확인해주세요.");
  };

  const saveAttendance = async () => {
    if (!supabase || !user || !me || !memberId) return;
    setBusy(true);
    const { error } = await supabase.from("attendance").insert({ member_id: memberId, activity, attended_on: date, created_by: user.id });
    setBusy(false);
    if (error) { setMessage(error.code === "23505" ? "이미 같은 날짜에 인증했어요." : error.message); return; }
    setMessage("출석이 기록됐어요."); setFormOpen(false); setWeek(getWeek(date)); await load(user);
  };

  const claimAdmin = async () => {
    if (!supabase || !user || !adminName.trim()) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.from("members").insert({ display_name: adminName.trim(), user_id: user.id, role: "admin" });
    setBusy(false);
    if (error) { setMessage("관리자 등록에 실패했어요. 이미 관리자가 있다면 다시 로그인해주세요."); return; }
    setSetupOpen(false); await load(user);
  };

  const addMembers = async () => {
    if (!supabase || me?.role !== "admin") return;
    const entries = memberLines.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
      const comma = line.indexOf(",");
      return comma < 0 ? null : { name: line.slice(0, comma).trim(), email: line.slice(comma + 1).trim() };
    });
    if (!entries.length || entries.some(entry => !entry?.name || !entry?.email)) {
      setMessage("한 줄에 ‘이름, 이메일’ 형식으로 입력해주세요."); return;
    }
    setBusy(true); setMessage("");
    const { data, error } = await supabase.rpc("admin_add_members", { entries });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setMessage(`${data}명의 회원을 등록했어요.`); setMemberLines(""); await load(user);
  };

  const openForm = (id?: string) => {
    if (!user || !me) { setLoginOpen(true); return; }
    setMemberId(me.role === "admin" && id ? id : me.id); setMessage(""); setFormOpen(true);
  };

  return <main>
    <header className="appHeader">
      <div className="identity"><span className="logo">BMT</span><div><b>BMT 출석</b><small>Better Mom Project</small></div></div>
      <div className="account">
        {me ? <><span><b>{me.display_name}</b>{me.role === "admin" ? " · 관리자" : ""}</span><button className="textButton" onClick={() => supabase?.auth.signOut()}>로그아웃</button></> : <button className="loginButton" onClick={() => setLoginOpen(true)}>로그인</button>}
      </div>
    </header>

    <section className="attendancePage">
      <div className="projectMeta"><span>2026. 08. 08 — 09. 04</span><b>4 WEEKS · 주 3회</b></div>
      <div className="headline"><div><p>현재 인증 현황</p><h1>우리는 지금<br/><em>{percent}%</em> 채웠어요.</h1></div><div className="score"><b>{completed}</b><span>/ {rows.length}명 이번 주 완료</span></div></div>

      <div className="weekTabs" role="tablist" aria-label="주차 선택">{[1,2,3,4].map(w => <button role="tab" aria-selected={week === w} className={week === w ? "active" : ""} onClick={() => setWeek(w)} key={w}><b>{w}주차</b><span>{weekRange(w).label}</span></button>)}</div>

      <section className="board">
        <div className="boardTitle"><div><span>WEEK {String(week).padStart(2,"0")}</span><h2>{range.label} 출석</h2></div><div className="boardActions">{me?.role === "admin" && <button className="memberButton" onClick={() => { setMessage(""); setBulkOpen(true); }}>회원 일괄 등록</button>}<button className="addButton" onClick={() => openForm()}>+ 인증 입력</button></div></div>
        <div className="columnHead"><span>회원</span><span>운동 3회</span><span>독서 3회</span><span>상태</span></div>
        <div className="memberList">{rows.map(row => <div className="attendanceRow" key={row.id}>
          <div className="memberName"><i>{row.display_name[0]}</i><div><b>{row.display_name}</b><small>{row.latest ? `마지막 인증 ${Number(row.latest.slice(5,7))}/${Number(row.latest.slice(8,10))}` : "아직 인증 없음"}</small></div></div>
          <div className="progressCell"><Marks count={Math.min(3,row.exercise)} activity="exercise"/><b>{Math.min(3,row.exercise)}/3</b></div>
          <div className="progressCell"><Marks count={Math.min(3,row.reading)} activity="reading"/><b>{Math.min(3,row.reading)}/3</b></div>
          <div className="rowAction"><span className={row.exercise >= 3 && row.reading >= 3 ? "complete" : "ongoing"}>{row.exercise >= 3 && row.reading >= 3 ? "완료" : row.exercise + row.reading === 0 ? "시작 전" : "진행 중"}</span>{me?.role === "admin" && <button onClick={() => openForm(row.id)}>+입력</button>}</div>
        </div>)}</div>
      </section>
      <p className="notice">각 인증은 본인과 관리자만 입력할 수 있어요. 2주차에 참여해도 8월 8일부터 오늘까지 지난 기록을 입력할 수 있어요.</p>
    </section>

    {loginOpen && <div className="modalBackdrop" onMouseDown={e => e.target === e.currentTarget && setLoginOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="login-title"><button className="close" onClick={() => setLoginOpen(false)} aria-label="닫기">×</button><span className="modalEyebrow">MEMBER LOGIN</span><h2 id="login-title">내 이름으로<br/>인증하기</h2><p>등록된 이메일로 로그인 링크를 보내드려요.</p><label htmlFor="email">이메일</label><input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/><button className="modalPrimary" onClick={sendLink} disabled={busy || !supabase}>{busy ? "보내는 중…" : "로그인 링크 받기"}</button>{!supabase && <small className="setupNote">Supabase 연결 후 로그인이 활성화됩니다.</small>}{message && <div className="formMessage">{message}</div>}</section></div>}

    {formOpen && <div className="modalBackdrop" onMouseDown={e => e.target === e.currentTarget && setFormOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title"><button className="close" onClick={() => setFormOpen(false)} aria-label="닫기">×</button><span className="modalEyebrow">ATTENDANCE</span><h2 id="form-title">인증 입력</h2>{me?.role === "admin" && <><label htmlFor="member">회원</label><select id="member" value={memberId} onChange={e => setMemberId(e.target.value)}>{members.map(m => <option value={m.id} key={m.id}>{m.display_name}</option>)}</select></>}<label>인증 종류</label><div className="typeButtons"><button className={activity === "exercise" ? "selected" : ""} onClick={() => setActivity("exercise")}>운동</button><button className={activity === "reading" ? "selected green" : ""} onClick={() => setActivity("reading")}>독서</button></div><label htmlFor="date">인증 날짜</label><input id="date" type="date" min={PROJECT_START} max={latestAllowedDate} value={date} onChange={e => setDate(e.target.value)}/><small className="fieldHelp">8월 8일부터 오늘까지만 선택할 수 있어요.</small><button className="modalPrimary" onClick={saveAttendance} disabled={busy}>{busy ? "저장 중…" : "출석 기록하기"}</button>{message && <div className="formMessage">{message}</div>}</section></div>}

    {setupOpen && <div className="modalBackdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="setup-title"><span className="modalEyebrow">FIRST SETUP</span><h2 id="setup-title">관리자 시작하기</h2><p>첫 관리자 이름을 등록하면 회원 명단을 한 번에 추가할 수 있어요.</p><label htmlFor="admin-name">관리자 이름</label><input id="admin-name" value={adminName} onChange={e => setAdminName(e.target.value)} placeholder="이름" maxLength={30}/><button className="modalPrimary" onClick={claimAdmin} disabled={busy || !adminName.trim()}>{busy ? "등록 중…" : "관리자로 시작하기"}</button>{message && <div className="formMessage">{message}</div>}</section></div>}

    {bulkOpen && <div className="modalBackdrop" onMouseDown={e => e.target === e.currentTarget && setBulkOpen(false)}><section className="modal wideModal" role="dialog" aria-modal="true" aria-labelledby="bulk-title"><button className="close" onClick={() => setBulkOpen(false)} aria-label="닫기">×</button><span className="modalEyebrow">MEMBER LIST</span><h2 id="bulk-title">회원 일괄 등록</h2><p>한 줄에 한 명씩 이름과 로그인 이메일을 넣어주세요.</p><label htmlFor="member-lines">이름, 이메일</label><textarea id="member-lines" value={memberLines} onChange={e => setMemberLines(e.target.value)} placeholder={"김서윤, seoyun@example.com\n이민지, minji@example.com"} rows={8}/><small className="fieldHelp">등록된 이메일은 화면에 공개되지 않아요. 회원은 같은 이메일로 로그인하면 자기 이름에 연결됩니다.</small><button className="modalPrimary" onClick={addMembers} disabled={busy || !memberLines.trim()}>{busy ? "등록 중…" : "회원 등록하기"}</button>{message && <div className="formMessage">{message}</div>}</section></div>}
  </main>;
}
