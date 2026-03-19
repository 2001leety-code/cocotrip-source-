import React from 'react';

export default function About() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-center mb-8">About Us</h1>
      <div className="flex flex-col items-center gap-8">
        <img src="/브랜드 상세페이지/1.jpeg" alt="Brand Story 1" className="w-full max-w-4xl rounded-lg shadow-lg" />
        <img src="/브랜드 상세페이지/2.jpeg" alt="Brand Story 2" className="w-full max-w-4xl rounded-lg shadow-lg" />
        <img src="/브랜드 상세페이지/3.jpeg" alt="Brand Story 3" className="w-full max-w-4xl rounded-lg shadow-lg" />
        <img src="/브랜드 상세페이지/4.jpeg" alt="Brand Story 4" className="w-full max-w-4xl rounded-lg shadow-lg" />
      </div>
    </div>
  );
}
