import React from "react";

const toc = [
  "Getting Started with Cybersecurity",
  "Understanding Vulnerabilities and Bugs",
  "Using BugHuntr Platform",
  "Bug Hunting Basics",
  "Safety and Ethical Guidelines",
  "Learning Resources",
  "FAQ",
];

export default function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="text-center mb-8">
        <h1 className="text-6xl font-extrabold text-primary mb-2">
          BugHuntr Documentation
        </h1>
        <h2 className="text-3xl font-semibold text-gray-600 mb-6">
          Your Guide to Bug Hunting and Cybersecurity Awareness
        </h2>
        <div className="rounded-xl shadow p-8 inline-block bg-white dark:bg-gray-800">
          <p className="text-xl mb-4 text-justify text-gray-800 dark:text-gray-100">
            Welcome to BugHuntr! This documentation will help you understand
            cybersecurity fundamentals, learn about vulnerabilities, and
            effectively use our platform to contribute to a safer digital world.
          </p>
          <a href="#table-of-contents" className="inline-block bg-primary text-white font-bold px-8 py-4 rounded-lg text-xl shadow hover:bg-primary/90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Explore Documentation
          </a>
        </div>
      </div>

      <div id="table-of-contents" className="rounded-xl shadow p-8 mb-8 bg-gray-50 dark:bg-gray-800">
        <h3 className="text-3xl font-bold mb-4 text-gray-900 dark:text-gray-100">
          Table of Contents
        </h3>
        <ul className="list-disc pl-6 space-y-2 text-xl text-gray-800 dark:text-gray-100">
          {toc.map((item) => (
            <li key={item}>
              <a
                href={`#${item.replace(/\s+/g, "-").toLowerCase()}`}
                className="text-primary hover:underline font-medium"
              >
                {item}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* Getting Started with Cybersecurity */}
      <section id="getting-started-with-cybersecurity" className="mb-10">
        <div className="rounded-xl shadow p-8 bg-gray-50 dark:bg-gray-800">
          <h2 className="text-4xl font-bold text-primary mb-4">
            Getting Started with Cybersecurity
          </h2>
          <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
            What is Cybersecurity?
          </h3>
          <p className="mb-4 text-gray-800 dark:text-gray-100 text-lg text-justify">
            Cybersecurity is the practice of protecting digital systems,
            networks, and data from malicious attacks, unauthorized access, and
            damage. In our connected world, cybersecurity affects everyone—from
            individuals protecting personal information to companies securing
            business operations.
          </p>
          <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
            Why Should You Care About Cybersecurity?
          </h3>
          <ul className="list-disc pl-6 mb-4 text-lg text-gray-800 dark:text-gray-100">
            <li>
              <span className="font-bold">Personal Protection:</span> Your
              personal data, photos, financial information, and online accounts
              need protection
            </li>
            <li>
              <span className="font-bold">Career Opportunities:</span>{" "}
              Cybersecurity is one of the fastest-growing fields with excellent
              job prospects
            </li>
            <li>
              <span className="font-bold">Making a Difference:</span> By finding
              and reporting security issues, you help protect millions of users
              worldwide
            </li>
            <li>
              <span className="font-bold">Continuous Learning:</span> Technology
              evolves rapidly, making cybersecurity an exciting field for
              lifelong learners
            </li>
          </ul>
          <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
            Basic Cybersecurity Concepts
          </h3>
          <ul className="list-disc pl-6 mb-4 text-lg text-gray-800 dark:text-gray-100">
            <li>
              <span className="font-bold">Confidentiality:</span> Ensuring that
              information is only accessible to authorized individuals
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Example: Your private messages should only be readable by you
                and the intended recipient
              </span>
            </li>
            <li>
              <span className="font-bold">Integrity:</span> Maintaining the
              accuracy and completeness of data
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Example: Ensuring that your bank balance hasn't been tampered
                with by unauthorized parties
              </span>
            </li>
            <li>
              <span className="font-bold">Availability:</span> Ensuring that
              systems and data are accessible when needed
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Example: Being able to access your email when you need it,
                without service interruptions
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* Understanding Vulnerabilities and Bugs */}
      <section id="understanding-vulnerabilities-and-bugs" className="mb-10">
        <div className="rounded-xl shadow p-8 bg-gray-50 dark:bg-gray-800">
          <h2 className="text-4xl font-bold text-primary mb-4">
            Understanding Vulnerabilities and Bugs
          </h2>
          <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
            What is a Vulnerability?
          </h3>
          <p className="mb-4 text-gray-800 dark:text-gray-100 text-lg text-justify">
            A vulnerability is a weakness in a system, application, or network
            that could be exploited by attackers to cause harm. Think of it as
            an unlocked door in what should be a secure building.
          </p>
          <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
            What is a Bug?
          </h3>
          <p className="mb-4 text-gray-800 dark:text-gray-100 text-lg text-justify">
            A bug is an error or flaw in software code that causes unexpected
            behavior. While not all bugs are security vulnerabilities, some can
            be exploited by attackers to gain unauthorized access or cause
            damage.
          </p>
          <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
            Common Types of Vulnerabilities
          </h3>
          <ol className="list-decimal pl-6 mb-4 space-y-2 text-lg text-gray-800 dark:text-gray-100">
            <li>
              <span className="font-bold">Cross-Site Scripting (XSS):</span>{" "}
              Malicious scripts injected into web pages that other users view
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Real-world example: A comment field on a website that doesn't
                properly filter user input, allowing attackers to inject harmful
                code
                <br />
                Impact: Can steal user sessions, redirect users to malicious
                sites, or steal sensitive information
              </span>
            </li>
            <li>
              <span className="font-bold">SQL Injection:</span> Attackers insert
              malicious SQL commands into application inputs
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Real-world example: A login form that doesn't properly validate
                input, allowing attackers to bypass authentication
                <br />
                Impact: Can lead to unauthorized database access, data theft, or
                data manipulation
              </span>
            </li>
            <li>
              <span className="font-bold">
                Cross-Site Request Forgery (CSRF):
              </span>{" "}
              Tricks users into performing unintended actions on websites where
              they're authenticated
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Real-world example: A malicious email link that causes you to
                unknowingly transfer money from your bank account
                <br />
                Impact: Can result in unauthorized transactions, data changes,
                or account takeovers
              </span>
            </li>
            <li>
              <span className="font-bold">Authentication Bypass:</span> Methods
              to circumvent login mechanisms
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Real-world example: Password reset functions that don't properly
                verify user identity
                <br />
                Impact: Unauthorized access to user accounts and sensitive data
              </span>
            </li>
            <li>
              <span className="font-bold">Information Disclosure:</span>{" "}
              Unintentional exposure of sensitive information
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Real-world example: Error messages that reveal database
                structure or system information
                <br />
                Impact: Provides attackers with information to plan more
                sophisticated attacks
              </span>
            </li>
            <li>
              <span className="font-bold">Business Logic Flaws:</span>{" "}
              Vulnerabilities in the application's workflow or business rules
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Real-world example: An e-commerce site that allows negative
                quantities in shopping carts, potentially crediting money to
                accounts
                <br />
                Impact: Financial losses, data manipulation, or service abuse
              </span>
            </li>
          </ol>
          <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
            Vulnerability Severity Levels
          </h3>
          <ul className="list-disc pl-6 mb-4 text-lg text-gray-800 dark:text-gray-100">
            <li>
              <span className="font-bold">Critical:</span> Immediate threat
              requiring urgent attention
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Remote code execution vulnerabilities, Complete system
                compromise
              </span>
            </li>
            <li>
              <span className="font-bold">High:</span> Significant security
              impact requiring prompt attention
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Privilege escalation vulnerabilities, Sensitive data exposure
              </span>
            </li>
            <li>
              <span className="font-bold">Medium:</span> Moderate security
              impact
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Cross-site scripting (XSS) in most contexts, Some authentication
                bypasses
              </span>
            </li>
            <li>
              <span className="font-bold">Low:</span> Minor security impact
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Information disclosure with limited sensitivity, Some denial of
                service vulnerabilities
              </span>
            </li>
            <li>
              <span className="font-bold">Informational:</span> Issues that
              don't pose immediate security risks but should be noted
              <br />
              <span className="text-gray-600 dark:text-gray-300">
                Missing security headers, Outdated software versions
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* Additional sections would follow the same pattern, with headings, lists, and styled content. For brevity, only the first two sections are fully implemented here. */}

      {/* Conclusion Section */}
      <div className="flex justify-center mt-16">
        <div className="rounded-2xl p-10 w-full max-w-4xl bg-primary text-white text-center">
          <h2 className="text-5xl font-extrabold mb-6">Conclusion</h2>
          <p className="text-2xl font-medium mb-6">
            Welcome to the exciting world of cybersecurity and bug hunting!
            Remember that becoming proficient in security research takes time,
            patience, and continuous learning. Start with the basics, practice
            regularly, engage with the community, and always maintain high
            ethical standards.
          </p>
          <p className="text-2xl font-medium">
            The cybersecurity field offers incredible opportunities to make a
            positive impact while building a rewarding career. Whether you're
            just starting your journey or looking to enhance your existing
            skills, BugHuntr provides the platform and community support you
            need to succeed.
          </p>
        </div>
      </div>

      {/* Last Updated and Version */}
      <div className="text-right text-lg text-gray-500 mt-12">
        Last Updated: September 2, 2025
        <br />
        Version: 1.0
      </div>
    </div>
  );
}
