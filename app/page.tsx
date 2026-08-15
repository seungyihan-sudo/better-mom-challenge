"use client";

import { useMemo, useState } from "react";

type Category = "exercise" | "reading";
type Check = { name: string; exercise: number; reading: number; tone: string };

const members: Check[] = [
  { name: "서윤", exercise: 3, reading: 3, tone: "#ef8f74" },
  { name: "민지", exercise: 2, reading: 3, tone: "#7b9d76" },
  { name: "지우", exercise: 3, reading: 1, tone: "#d2a04e" },
  { name: "현지", exercise: 1, reading: 2, tone: "#8e7cae" },
  { name: "하은", exercise: 2, reading: 2, tone: "#5a9cad" },
];

const initialPosts = [
  { id: 1, name: "서윤", category: "exercise" as Category, detail: "오늘은 30분 런닝! 시작이 반이라는 말이 딱 맞았어요.", meta: "오전 7:42 · 운동 3/3", color: "#ef8f74", likes: 12 },
  { id: 2, name: "민지", category: "reading" as Category, detail: "《어른의 행복은 조용하다》 42쪽. 오늘 문장은 ‘조급함을 내려놓기’.", meta: "어제 오후 10:18 · 독서 3/3", color: "#7b9d76", likes: 9 },
  { id: 3, name: "지우", category: "exercise" as Category, detail: "근력 20분 + 스트레칭 10분. 짧아도 하고 나니 몸이 가벼워요!", meta: "어제 오전 8:05 · 운동 3/3", color: "#d2a04e", likes: 7 },
];

function Ring({ value, color, label }: { value: number; color: string; label: string }) {
  return <div className="ring" style={{ "--progress": `${value * 3.6}deg`, "--ring": color } as React.CSSProperties} aria-label={`${label} ${value}%`}><div><strong>{value}%</strong><span>{label}</span></div></div>;
}

export default function Home() {
  const [tab, setTab] = useState<"home" | "check" | "leader">("home");
  const [posts, setPosts] = useState(initialPosts);
  const [category, setCategory] = useState<Category>("exercise");
  const [memo, setMemo] = useState("");
  const [toast, setToast] = useState("");
  const [liked, setLiked] = useState<number[]>([]);
  const stats = useMemo(() => ({ exercise: 8, reading: 7 }), []);

  const submit = () => {
    if (!memo.trim()) { setToast("오늘의 인증 내용을 적어주세요."); return; }
    setPosts([{ id: Date.now(), name: "나", category, detail: memo, meta: "방금 · 인증 완료", color: "#e26d5c", likes: 0 }, ...posts]);
    setMemo(""); setToast("멋져요! 오늘 인증이 기록됐어요 🌿"); setTab("home");
    window.setTimeout(() => setToast(""), 2600);
  };

  return <main>
    <header className="topbar">
      <button className="brand" onClick={() => setTab("home")} aria-label="홈으로"><span className="brandmark">B</span><span>베러맘</span></button>
      <nav aria-label="주요 메뉴">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>우리의 기록</button>
        <button className={tab === "leader" ? "active" : ""} onClick={() => setTab("leader")}>출석현황</button>
      </nav>
      <button className="profile" aria-label="내 프로필">Y</button>
    </header>

    <section className="shell">
      {tab === "home" && <>
        <div className="eyebrow"><span /> BETTER MOM · 4 WEEKS</div>
        <section className="hero">
          <div><p className="week">2주차 · 8월 10일 — 8월 16일</p><h1>조금씩, 그래도<br/><em>확실하게.</em></h1><p className="intro">매일이 아니어도 괜찮아요. 이번 주 운동과 독서를<br/>3번씩 채우며 나다운 리듬을 만들어요.</p></div>
          <div className="heroStats">
            <Ring value={67} color="#e26d5c" label="운동"/><Ring value={58} color="#55765b" label="독서"/>
            <p><b>전체 24회 중 15회 완료</b><span>이번 주 목표까지 3회 남았어요</span></p>
          </div>
        </section>

        <section className="weekCard">
          <div className="weekTitle"><div><span>WEEK 02</span><h2>이번 주의 약속</h2></div><button className="primary" onClick={() => setTab("check")}>+ 오늘 인증하기</button></div>
          <div className="goals">
            <div className="goal"><div className="goalIcon exercise">🏃</div><div><span>운동</span><b>{stats.exercise > 0 ? 2 : 0}<small> / 3회</small></b></div><div className="dots" aria-label="운동 3회 중 2회"><i className="on"/><i className="on"/><i/></div><strong>1회 더!</strong></div>
            <div className="goal"><div className="goalIcon reading">📖</div><div><span>독서</span><b>2<small> / 3회</small></b></div><div className="dots green" aria-label="독서 3회 중 2회"><i className="on"/><i className="on"/><i/></div><strong>1회 더!</strong></div>
          </div>
        </section>

        <section className="feedHead"><div><span>서로의 오늘</span><h2>함께 채워가는 기록</h2></div><p>우리의 작은 실천이<br/>누군가에겐 큰 자극이 돼요.</p></section>
        <div className="feed">{posts.map(post => <article className="post" key={post.id}>
          <div className="avatar" style={{background: post.color}}>{post.name[0]}</div>
          <div className="postBody"><div className="postMeta"><b>{post.name}</b><span className={`tag ${post.category}`}>{post.category === "exercise" ? "운동" : "독서"}</span><time>{post.meta}</time></div><p>{post.detail}</p>
          <button className={liked.includes(post.id) ? "like liked" : "like"} onClick={() => setLiked(liked.includes(post.id) ? liked.filter(x => x !== post.id) : [...liked, post.id])} aria-label="응원하기">♥ {post.likes + (liked.includes(post.id) ? 1 : 0)}</button></div>
        </article>)}</div>
      </>}

      {tab === "check" && <section className="formPage">
        <button className="back" onClick={() => setTab("home")}>← 돌아가기</button><div className="eyebrow"><span/> TODAY'S RECORD</div><h1>오늘의 나를<br/><em>기록해요.</em></h1><p>짧은 한 줄이어도 좋아요. 오늘의 실천을 남겨주세요.</p>
        <div className="formCard"><label>무엇을 인증할까요?</label><div className="categoryPick"><button className={category === "exercise" ? "selected" : ""} onClick={() => setCategory("exercise")}>🏃 <span><b>운동</b>몸을 움직인 기록</span></button><button className={category === "reading" ? "selected reading" : ""} onClick={() => setCategory("reading")}>📖 <span><b>독서</b>마음을 채운 기록</span></button></div>
          <label htmlFor="memo">오늘의 기록</label><textarea id="memo" value={memo} onChange={e => setMemo(e.target.value)} placeholder="오늘 한 운동, 읽은 책과 느낀 점을 자유롭게 적어보세요."/><button className="submit" onClick={submit}>이 기록 인증하기 →</button>
        </div>
      </section>}

      {tab === "leader" && <section className="leaderPage">
        <div className="eyebrow"><span/> LEADER'S VIEW</div><div className="leaderTitle"><div><h1>우리의 <em>진도</em></h1><p>2주차 회원별 인증 현황을 한눈에 확인해요.</p></div><div className="miniStat"><b>5</b><span>함께하는 회원</span></div></div>
        <div className="leaderSummary"><div><b>60%</b><span>이번 주 전체 달성률</span></div><div><b>2명</b><span>운동 목표 달성</span></div><div><b>1명</b><span>독서 목표 달성</span></div><div><b>3명</b><span>응원이 필요해요</span></div></div>
        <div className="tableWrap"><div className="tableHead"><span>회원</span><span>운동 진도</span><span>독서 진도</span><span>상태</span></div>{members.map(m => <div className="memberRow" key={m.name}><div><i style={{background:m.tone}}>{m.name[0]}</i><b>{m.name}</b></div><div><span className="smallDots exerciseDots">{[0,1,2].map(x => <i className={x < m.exercise ? "filled" : ""} key={x}/>)}</span><b>{m.exercise}/3</b></div><div><span className="smallDots readingDots">{[0,1,2].map(x => <i className={x < m.reading ? "filled" : ""} key={x}/>)}</span><b>{m.reading}/3</b></div><span className={m.exercise === 3 && m.reading === 3 ? "status done" : "status"}>{m.exercise === 3 && m.reading === 3 ? "이번 주 완료" : "진행 중"}</span></div>)}</div>
      </section>}
    </section>
    {toast && <div className="toast" role="status">{toast}</div>}
    <footer><span>베러맘</span><p>나를 돌보는 4주, 함께라서 더 오래.</p><small>BETTER MOM CHALLENGE</small></footer>
  </main>;
}
